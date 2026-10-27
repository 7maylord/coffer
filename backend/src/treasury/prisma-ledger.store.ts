import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  JournalSide,
  LedgerNormalSide,
  Prisma,
  PrismaClient,
  ReservationStatus,
  type LedgerAccount,
  type JournalTransaction,
  type JournalLine,
  type BalanceReservation,
} from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  InsufficientFundsError,
  LedgerConflictError,
  LedgerNotFoundError,
  type JournalView,
  type LedgerAccountView,
  type LedgerStore,
  type ReservationView,
} from './ledger.types.js';

type JournalRecord = JournalTransaction & {
  lines: JournalLine[];
  reversedBy?: { id: string } | null;
};

@Injectable()
export class PrismaLedgerStore implements LedgerStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async listAccounts(organizationId: string): Promise<LedgerAccountView[]> {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ assetId: 'asc' }, { code: 'asc' }],
    });
    return accounts.map(mapAccount);
  }

  async createAccount(
    input: Parameters<LedgerStore['createAccount']>[0],
  ): Promise<LedgerAccountView> {
    try {
      const account = await this.prisma.ledgerAccount.create({ data: input });
      return mapAccount(account);
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new LedgerConflictError('Ledger account code already exists');
      }
      throw error;
    }
  }

  async getAccount(
    input: Parameters<LedgerStore['getAccount']>[0],
  ): Promise<LedgerAccountView | null> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: {
        id: input.accountId,
        organizationId: input.organizationId,
        archivedAt: null,
      },
    });
    return account ? mapAccount(account) : null;
  }

  async getAccountByCode(
    input: Parameters<LedgerStore['getAccountByCode']>[0],
  ): Promise<LedgerAccountView | null> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: {
        organizationId_assetId_code: input,
      },
    });
    return account && !account.archivedAt ? mapAccount(account) : null;
  }

  async postJournal(
    input: Parameters<LedgerStore['postJournal']>[0],
  ): Promise<{ journal: JournalView; created: boolean }> {
    try {
      return await this.serializable(async (transaction) => {
        const existing = await transaction.journalTransaction.findUnique({
          where: {
            organizationId_reference: {
              organizationId: input.organizationId,
              reference: input.reference,
            },
          },
          include: { lines: true, reversedBy: { select: { id: true } } },
        });
        if (existing) return existingJournal(existing, input.requestDigest);

        const accountIds = [
          ...new Set(input.lines.map(({ accountId }) => accountId)),
        ].sort();
        await lockAccounts(
          transaction,
          input.organizationId,
          input.assetId,
          accountIds,
        );
        const accounts = await transaction.ledgerAccount.findMany({
          where: {
            id: { in: accountIds },
            organizationId: input.organizationId,
            assetId: input.assetId,
            archivedAt: null,
          },
        });
        if (accounts.length !== accountIds.length) {
          throw new LedgerNotFoundError(
            'Ledger account not found for organization and asset',
          );
        }

        const deltas = new Map<string, bigint>();
        for (const line of input.lines) {
          const account = accounts.find(({ id }) => id === line.accountId)!;
          const increase =
            (line.side === JournalSide.DEBIT &&
              account.normalSide === LedgerNormalSide.DEBIT) ||
            (line.side === JournalSide.CREDIT &&
              account.normalSide === LedgerNormalSide.CREDIT);
          const signedAmount =
            BigInt(line.amountAtomic) * (increase ? 1n : -1n);
          deltas.set(account.id, (deltas.get(account.id) ?? 0n) + signedAmount);
        }

        for (const account of accounts) {
          const posted = decimalToBigInt(account.postedBalanceAtomic);
          const reserved = decimalToBigInt(account.reservedBalanceAtomic);
          const next = posted + (deltas.get(account.id) ?? 0n);
          if (next < reserved) {
            throw new InsufficientFundsError(
              'Posting would spend unavailable funds',
            );
          }
        }

        const journalRecord = await transaction.journalTransaction.create({
          data: {
            organizationId: input.organizationId,
            assetId: input.assetId,
            reference: input.reference,
            requestDigest: input.requestDigest,
            description: input.description,
            reversalOfId: input.reversalOfId,
          },
        });
        await transaction.journalLine.createMany({
          data: input.lines.map((line) => ({
            organizationId: input.organizationId,
            assetId: input.assetId,
            transactionId: journalRecord.id,
            accountId: line.accountId,
            side: line.side,
            amountAtomic: new Prisma.Decimal(line.amountAtomic),
          })),
        });
        for (const account of accounts) {
          const next =
            decimalToBigInt(account.postedBalanceAtomic) +
            (deltas.get(account.id) ?? 0n);
          await transaction.ledgerAccount.update({
            where: { id: account.id },
            data: {
              postedBalanceAtomic: new Prisma.Decimal(next.toString()),
              version: { increment: 1 },
            },
          });
        }
        const journal = await transaction.journalTransaction.findUniqueOrThrow({
          where: { id: journalRecord.id },
          include: { lines: true, reversedBy: { select: { id: true } } },
        });
        return { journal: mapJournal(journal), created: true };
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        const existing = await this.prisma.journalTransaction.findUnique({
          where: {
            organizationId_reference: {
              organizationId: input.organizationId,
              reference: input.reference,
            },
          },
          include: { lines: true, reversedBy: { select: { id: true } } },
        });
        if (existing) return existingJournal(existing, input.requestDigest);
        throw new LedgerConflictError('Original journal is already reversed');
      }
      throw error;
    }
  }

  async getJournal(
    input: Parameters<LedgerStore['getJournal']>[0],
  ): Promise<JournalView | null> {
    const journal = await this.prisma.journalTransaction.findFirst({
      where: { id: input.journalId, organizationId: input.organizationId },
      include: { lines: true, reversedBy: { select: { id: true } } },
    });
    return journal ? mapJournal(journal) : null;
  }

  async reserve(
    input: Parameters<LedgerStore['reserve']>[0],
  ): Promise<{ reservation: ReservationView; created: boolean }> {
    try {
      return await this.serializable(async (transaction) => {
        const existing = await transaction.balanceReservation.findUnique({
          where: {
            organizationId_reference: {
              organizationId: input.organizationId,
              reference: input.reference,
            },
          },
        });
        if (existing) return existingReservation(existing, input.requestDigest);

        await lockAccounts(transaction, input.organizationId, input.assetId, [
          input.accountId,
        ]);
        const account = await transaction.ledgerAccount.findFirst({
          where: {
            id: input.accountId,
            organizationId: input.organizationId,
            assetId: input.assetId,
            archivedAt: null,
          },
        });
        if (!account) throw new LedgerNotFoundError('Ledger account not found');
        const amount = BigInt(input.amountAtomic);
        const posted = decimalToBigInt(account.postedBalanceAtomic);
        const reserved = decimalToBigInt(account.reservedBalanceAtomic);
        if (posted - reserved < amount) {
          throw new InsufficientFundsError(
            'Reservation exceeds available balance',
          );
        }
        const reservation = await transaction.balanceReservation.create({
          data: {
            ...input,
            amountAtomic: new Prisma.Decimal(input.amountAtomic),
          },
        });
        await transaction.ledgerAccount.update({
          where: { id: account.id },
          data: {
            reservedBalanceAtomic: new Prisma.Decimal(
              (reserved + amount).toString(),
            ),
            version: { increment: 1 },
          },
        });
        return { reservation: mapReservation(reservation), created: true };
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        const existing = await this.prisma.balanceReservation.findUnique({
          where: {
            organizationId_reference: {
              organizationId: input.organizationId,
              reference: input.reference,
            },
          },
        });
        if (existing) return existingReservation(existing, input.requestDigest);
      }
      throw error;
    }
  }

  releaseReservation(
    input: Parameters<LedgerStore['releaseReservation']>[0],
  ): Promise<ReservationView | null> {
    return this.serializable(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "BalanceReservation" WHERE "id" = ${input.reservationId}::uuid AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE`,
      );
      const reservation = await transaction.balanceReservation.findFirst({
        where: {
          id: input.reservationId,
          organizationId: input.organizationId,
        },
      });
      if (!reservation) return null;
      if (reservation.status !== ReservationStatus.ACTIVE) {
        return mapReservation(reservation);
      }
      await lockAccounts(
        transaction,
        reservation.organizationId,
        reservation.assetId,
        [reservation.accountId],
      );
      const account = await transaction.ledgerAccount.findUniqueOrThrow({
        where: { id: reservation.accountId },
      });
      const nextReserved =
        decimalToBigInt(account.reservedBalanceAtomic) -
        decimalToBigInt(reservation.amountAtomic);
      const released = await transaction.balanceReservation.update({
        where: { id: reservation.id },
        data: {
          status: ReservationStatus.RELEASED,
          releasedAt: input.releasedAt,
          version: { increment: 1 },
        },
      });
      await transaction.ledgerAccount.update({
        where: { id: account.id },
        data: {
          reservedBalanceAtomic: new Prisma.Decimal(nextReserved.toString()),
          version: { increment: 1 },
        },
      });
      return mapReservation(released);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (!serializationConflict(error) || attempt === 4) throw error;
      }
    }
    throw new Error('Unreachable serializable transaction retry');
  }
}

async function lockAccounts(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  assetId: string,
  accountIds: string[],
): Promise<void> {
  if (accountIds.length === 0) return;
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "LedgerAccount" WHERE "organizationId" = ${organizationId}::uuid AND "assetId" = ${assetId} AND "id" IN (${Prisma.join(accountIds.map((accountId) => Prisma.sql`${accountId}::uuid`))}) ORDER BY "id" FOR UPDATE`,
  );
}

function mapAccount(account: LedgerAccount): LedgerAccountView {
  const posted = decimalToBigInt(account.postedBalanceAtomic);
  const reserved = decimalToBigInt(account.reservedBalanceAtomic);
  return {
    id: account.id,
    organizationId: account.organizationId,
    assetId: account.assetId,
    code: account.code,
    name: account.name,
    accountType: account.accountType,
    normalSide: account.normalSide,
    postedBalanceAtomic: posted.toString(),
    reservedBalanceAtomic: reserved.toString(),
    availableBalanceAtomic: (posted - reserved).toString(),
    version: account.version,
  };
}

function mapJournal(journal: JournalRecord): JournalView {
  return {
    id: journal.id,
    organizationId: journal.organizationId,
    assetId: journal.assetId,
    reference: journal.reference,
    requestDigest: journal.requestDigest,
    description: journal.description,
    reversalOfId: journal.reversalOfId,
    reversedById: journal.reversedBy?.id ?? null,
    createdAt: journal.createdAt,
    lines: journal.lines.map((line) => ({
      accountId: line.accountId,
      side: line.side,
      amountAtomic: line.amountAtomic.toFixed(0),
    })),
  };
}

function mapReservation(reservation: BalanceReservation): ReservationView {
  return {
    id: reservation.id,
    organizationId: reservation.organizationId,
    assetId: reservation.assetId,
    accountId: reservation.accountId,
    reference: reservation.reference,
    requestDigest: reservation.requestDigest,
    amountAtomic: reservation.amountAtomic.toFixed(0),
    status: reservation.status,
    expiresAt: reservation.expiresAt,
    version: reservation.version,
  };
}

function existingJournal(
  journal: JournalRecord,
  requestDigest: string,
): { journal: JournalView; created: false } {
  if (journal.requestDigest !== requestDigest) {
    throw new LedgerConflictError(
      'Journal reference was reused with a different request',
    );
  }
  return { journal: mapJournal(journal), created: false };
}

function existingReservation(
  reservation: BalanceReservation,
  requestDigest: string,
): { reservation: ReservationView; created: false } {
  if (reservation.requestDigest !== requestDigest) {
    throw new LedgerConflictError(
      'Reservation reference was reused with a different request',
    );
  }
  return { reservation: mapReservation(reservation), created: false };
}

function decimalToBigInt(value: Prisma.Decimal): bigint {
  return BigInt(value.toFixed(0));
}

function knownPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function serializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' &&
      typeof error.meta === 'object' &&
      error.meta !== null &&
      'code' in error.meta &&
      error.meta.code === '40001')
  );
}
