import { createHash } from 'node:crypto';
import {
  JournalSide,
  LedgerAccountType,
  LedgerNormalSide,
} from '@prisma/client';
import { AssetRegistry } from './asset-registry.js';
import {
  type JournalLineInput,
  type LedgerStore,
  LedgerConflictError,
  LedgerNotFoundError,
  LedgerValidationError,
} from './ledger.types.js';
import { parseAtomicAmount, splitAtomicAmount } from './money.js';

const normalSideByType: Readonly<Record<LedgerAccountType, LedgerNormalSide>> =
  {
    ASSET: LedgerNormalSide.DEBIT,
    EXPENSE: LedgerNormalSide.DEBIT,
    LIABILITY: LedgerNormalSide.CREDIT,
    EQUITY: LedgerNormalSide.CREDIT,
    REVENUE: LedgerNormalSide.CREDIT,
  };

export class LedgerService {
  constructor(
    private readonly store: LedgerStore,
    private readonly assets = new AssetRegistry(),
  ) {}

  accounts(organizationId: string) {
    return this.store.listAccounts(organizationId);
  }

  async account(organizationId: string, accountId: string) {
    const account = await this.store.getAccount({ organizationId, accountId });
    if (!account) throw new LedgerNotFoundError('Ledger account not found');
    return account;
  }

  createAccount(input: {
    organizationId: string;
    assetId: string;
    code: string;
    name: string;
    accountType: LedgerAccountType;
  }) {
    this.assets.require(input.assetId);
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(input.code)) {
      throw new LedgerValidationError('Invalid ledger account code');
    }
    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) {
      throw new LedgerValidationError('Invalid ledger account name');
    }
    return this.store.createAccount({
      ...input,
      name,
      normalSide: normalSideByType[input.accountType],
    });
  }

  async ensureAccount(input: {
    organizationId: string;
    assetId: string;
    code: string;
    name: string;
    accountType: LedgerAccountType;
  }) {
    const existing = await this.store.getAccountByCode({
      organizationId: input.organizationId,
      assetId: input.assetId,
      code: input.code,
    });
    if (existing) return existing;
    try {
      return await this.createAccount(input);
    } catch (error) {
      if (!(error instanceof LedgerConflictError)) throw error;
      const raced = await this.store.getAccountByCode({
        organizationId: input.organizationId,
        assetId: input.assetId,
        code: input.code,
      });
      if (!raced) throw error;
      return raced;
    }
  }

  post(input: {
    organizationId: string;
    assetId: string;
    reference: string;
    description: string;
    lines: JournalLineInput[];
  }) {
    return this.postValidated(input);
  }

  async reverse(input: {
    organizationId: string;
    originalJournalId: string;
    reference: string;
    description?: string;
  }) {
    const original = await this.store.getJournal({
      organizationId: input.organizationId,
      journalId: input.originalJournalId,
    });
    if (!original)
      throw new LedgerNotFoundError('Journal transaction not found');
    if (original.reversalOfId) {
      throw new LedgerValidationError('A reversal cannot be reversed directly');
    }
    if (original.reversedById) {
      throw new LedgerConflictError('Journal transaction is already reversed');
    }
    return this.postValidated({
      organizationId: input.organizationId,
      assetId: original.assetId,
      reference: input.reference,
      description: input.description ?? `Reversal: ${original.description}`,
      reversalOfId: original.id,
      lines: original.lines.map((line) => ({
        ...line,
        side:
          line.side === JournalSide.DEBIT
            ? JournalSide.CREDIT
            : JournalSide.DEBIT,
      })),
    });
  }

  postSplit(input: {
    organizationId: string;
    assetId: string;
    sourceAccountId: string;
    amountAtomic: string;
    reference: string;
    description: string;
    remainderRecipientId: string;
    shares: Array<{
      recipientId: string;
      accountId: string;
      basisPoints: number;
    }>;
  }) {
    const amount = parseAtomicAmount(input.amountAtomic);
    const allocations = splitAtomicAmount(
      amount,
      input.shares.map(({ recipientId, basisPoints }) => ({
        recipientId,
        basisPoints,
      })),
      input.remainderRecipientId,
    );
    const accountByRecipient = new Map(
      input.shares.map(({ recipientId, accountId }) => [
        recipientId,
        accountId,
      ]),
    );
    return this.postValidated({
      organizationId: input.organizationId,
      assetId: input.assetId,
      reference: input.reference,
      description: input.description,
      lines: [
        {
          accountId: input.sourceAccountId,
          side: JournalSide.CREDIT,
          amountAtomic: amount.toString(),
        },
        ...allocations.map((allocation) => ({
          accountId: accountByRecipient.get(allocation.recipientId)!,
          side: JournalSide.DEBIT,
          amountAtomic: allocation.amountAtomic,
        })),
      ],
    });
  }

  reserve(input: {
    organizationId: string;
    assetId: string;
    accountId: string;
    reference: string;
    amountAtomic: string;
    expiresAt?: Date;
  }) {
    this.assets.require(input.assetId);
    const amountAtomic = parseAtomicAmount(input.amountAtomic).toString();
    validateReference(input.reference);
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new LedgerValidationError(
        'Reservation expiry must be in the future',
      );
    }
    const requestDigest = digest({
      operation: 'reserve',
      organizationId: input.organizationId,
      assetId: input.assetId,
      accountId: input.accountId,
      reference: input.reference,
      amountAtomic,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    });
    return this.store.reserve({ ...input, amountAtomic, requestDigest });
  }

  releaseReservation(input: {
    organizationId: string;
    reservationId: string;
    releasedAt?: Date;
  }) {
    return this.store.releaseReservation({
      organizationId: input.organizationId,
      reservationId: input.reservationId,
      releasedAt: input.releasedAt ?? new Date(),
    });
  }

  private postValidated(input: {
    organizationId: string;
    assetId: string;
    reference: string;
    description: string;
    reversalOfId?: string;
    lines: JournalLineInput[];
  }) {
    this.assets.require(input.assetId);
    validateReference(input.reference);
    const description = input.description.trim();
    if (description.length === 0 || description.length > 200) {
      throw new LedgerValidationError('Invalid journal description');
    }
    if (input.lines.length < 2 || input.lines.length > 100) {
      throw new LedgerValidationError(
        'Journal requires between 2 and 100 lines',
      );
    }
    const lines = input.lines.map((line) => ({
      accountId: line.accountId,
      side: line.side,
      amountAtomic: parseAtomicAmount(line.amountAtomic).toString(),
    }));
    const debitTotal = total(lines, JournalSide.DEBIT);
    const creditTotal = total(lines, JournalSide.CREDIT);
    if (debitTotal !== creditTotal) {
      throw new LedgerValidationError(
        'Journal debits and credits must balance',
      );
    }
    const canonicalLines = [...lines].sort((left, right) =>
      `${left.accountId}:${left.side}:${left.amountAtomic}`.localeCompare(
        `${right.accountId}:${right.side}:${right.amountAtomic}`,
      ),
    );
    const requestDigest = digest({
      operation: 'post-journal',
      organizationId: input.organizationId,
      assetId: input.assetId,
      reference: input.reference,
      description,
      reversalOfId: input.reversalOfId ?? null,
      lines: canonicalLines,
    });
    return this.store.postJournal({
      ...input,
      description,
      lines,
      requestDigest,
    });
  }
}

function total(lines: JournalLineInput[], side: JournalSide): bigint {
  return lines
    .filter((line) => line.side === side)
    .reduce((sum, line) => sum + BigInt(line.amountAtomic), 0n);
}

function validateReference(reference: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{2,127}$/.test(reference)) {
    throw new LedgerValidationError('Invalid idempotency reference');
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
