import { randomUUID } from 'node:crypto';
import {
  JournalSide,
  LedgerAccountType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { LedgerService } from '../src/treasury/ledger.service.js';
import {
  InsufficientFundsError,
  LedgerConflictError,
} from '../src/treasury/ledger.types.js';
import { PrismaLedgerStore } from '../src/treasury/prisma-ledger.store.js';

describe('ledger transaction invariants', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaLedgerStore(environment);
  const service = new LedgerService(store);
  const suffix = randomUUID().slice(0, 8);
  const assetId = 'mock:near:usdc';
  let organizationId: string;
  let treasuryId: string;
  let revenueId: string;
  let expenseId: string;
  let payrollId: string;
  let operationsId: string;
  let partnersId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { slug: `ledger-${suffix}`, name: 'Ledger Integration Fixture' },
    });
    organizationId = organization.id;
    const create = (code: string, accountType: LedgerAccountType) =>
      service.createAccount({
        organizationId,
        assetId,
        code,
        name: code,
        accountType,
      });
    [
      { id: treasuryId },
      { id: revenueId },
      { id: expenseId },
      { id: payrollId },
      { id: operationsId },
      { id: partnersId },
    ] = await Promise.all([
      create('TREASURY', LedgerAccountType.ASSET),
      create('REVENUE', LedgerAccountType.REVENUE),
      create('EXPENSE', LedgerAccountType.EXPENSE),
      create('PAYROLL', LedgerAccountType.ASSET),
      create('OPERATIONS', LedgerAccountType.ASSET),
      create('PARTNERS', LedgerAccountType.ASSET),
    ]);
  });

  afterAll(async () => {
    // Posted financial facts are intentionally immutable. CI uses a disposable
    // database; local synthetic fixtures retain their random organization.
    await store.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('T-LED-01 posts equal debits and credits and T-LED-07 deduplicates a reference', async () => {
    const input = {
      organizationId,
      assetId,
      reference: `fund:${suffix}`,
      description: 'Synthetic opening revenue',
      lines: [
        {
          accountId: treasuryId,
          side: JournalSide.DEBIT,
          amountAtomic: '1000',
        },
        {
          accountId: revenueId,
          side: JournalSide.CREDIT,
          amountAtomic: '1000',
        },
      ],
    };
    const first = await service.post(input);
    const repeated = await service.post(input);
    expect(first.created).toBe(true);
    expect(repeated).toMatchObject({
      created: false,
      journal: { id: first.journal.id },
    });
    await expect(
      service.post({ ...input, description: 'Changed payload' }),
    ).rejects.toBeInstanceOf(LedgerConflictError);
    await expect(
      store.getAccount({ organizationId, accountId: treasuryId }),
    ).resolves.toMatchObject({
      postedBalanceAtomic: '1000',
      reservedBalanceAtomic: '0',
      availableBalanceAtomic: '1000',
    });
    expect(
      await prisma.journalTransaction.count({
        where: { organizationId, reference: input.reference },
      }),
    ).toBe(1);
  });

  it('T-LED-02 atomically rejects an overdraft', async () => {
    await expect(
      service.post({
        organizationId,
        assetId,
        reference: `overdraft:${suffix}`,
        description: 'Must fail atomically',
        lines: [
          {
            accountId: expenseId,
            side: JournalSide.DEBIT,
            amountAtomic: '1001',
          },
          {
            accountId: treasuryId,
            side: JournalSide.CREDIT,
            amountAtomic: '1001',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(
      await prisma.journalTransaction.count({
        where: { organizationId, reference: `overdraft:${suffix}` },
      }),
    ).toBe(0);
    await expect(
      store.getAccount({ organizationId, accountId: treasuryId }),
    ).resolves.toMatchObject({ postedBalanceAtomic: '1000' });
    await expect(
      store.getAccount({ organizationId, accountId: expenseId }),
    ).resolves.toMatchObject({ postedBalanceAtomic: '0' });
  });

  it('T-LED-03 serializes concurrent reservations so they cannot exceed funds', async () => {
    const attempts = await Promise.allSettled([
      service.reserve({
        organizationId,
        assetId,
        accountId: treasuryId,
        reference: `reserve-a:${suffix}`,
        amountAtomic: '700',
      }),
      service.reserve({
        organizationId,
        assetId,
        accountId: treasuryId,
        reference: `reserve-b:${suffix}`,
        amountAtomic: '700',
      }),
    ]);
    const fulfilled = attempts.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.reserve>>
      > => result.status === 'fulfilled',
    );
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.any(InsufficientFundsError),
    });
    await expect(
      store.getAccount({ organizationId, accountId: treasuryId }),
    ).resolves.toMatchObject({
      reservedBalanceAtomic: '700',
      availableBalanceAtomic: '300',
    });
    await service.releaseReservation({
      organizationId,
      reservationId: fulfilled[0].value.reservation.id,
    });
    await expect(
      store.getAccount({ organizationId, accountId: treasuryId }),
    ).resolves.toMatchObject({
      reservedBalanceAtomic: '0',
      availableBalanceAtomic: '1000',
    });
  });

  it('T-LED-06/07 posts one deterministic split journal for repeated requests', async () => {
    const input = {
      organizationId,
      assetId,
      sourceAccountId: treasuryId,
      amountAtomic: '601',
      reference: `split:${suffix}`,
      description: 'Three-way synthetic allocation',
      remainderRecipientId: 'partners',
      shares: [
        { recipientId: 'payroll', accountId: payrollId, basisPoints: 5000 },
        {
          recipientId: 'operations',
          accountId: operationsId,
          basisPoints: 3000,
        },
        { recipientId: 'partners', accountId: partnersId, basisPoints: 2000 },
      ],
    };
    const first = await service.postSplit(input);
    const repeated = await service.postSplit(input);
    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(
      first.journal.lines.map(({ amountAtomic }) => amountAtomic).sort(),
    ).toEqual(['121', '180', '300', '601']);
    expect(
      await prisma.journalTransaction.count({
        where: { organizationId, reference: input.reference },
      }),
    ).toBe(1);
  });

  it('T-LED-04 creates an immutable reversal and preserves the original', async () => {
    const original = await prisma.journalTransaction.findUniqueOrThrow({
      where: {
        organizationId_reference: {
          organizationId,
          reference: `split:${suffix}`,
        },
      },
      include: { lines: true },
    });
    const reversed = await service.reverse({
      organizationId,
      originalJournalId: original.id,
      reference: `split-reversal:${suffix}`,
    });
    expect(reversed.journal.reversalOfId).toBe(original.id);
    const preserved = await prisma.journalTransaction.findUniqueOrThrow({
      where: { id: original.id },
      include: { lines: true },
    });
    expect(preserved.requestDigest).toBe(original.requestDigest);
    expect(preserved.lines).toHaveLength(original.lines.length);
    await expect(
      store.getAccount({ organizationId, accountId: treasuryId }),
    ).resolves.toMatchObject({ postedBalanceAtomic: '1000' });
    await expect(
      service.reverse({
        organizationId,
        originalJournalId: original.id,
        reference: `second-reversal:${suffix}`,
      }),
    ).rejects.toBeInstanceOf(LedgerConflictError);
  });

  it('rejects an unbalanced journal at the deferred database constraint', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        const journal = await transaction.journalTransaction.create({
          data: {
            organizationId,
            assetId,
            reference: `direct-unbalanced:${suffix}`,
            requestDigest: '0'.repeat(64),
            description: 'Database constraint fixture',
          },
        });
        await transaction.journalLine.createMany({
          data: [
            {
              organizationId,
              assetId,
              transactionId: journal.id,
              accountId: expenseId,
              side: JournalSide.DEBIT,
              amountAtomic: new Prisma.Decimal('5'),
            },
            {
              organizationId,
              assetId,
              transactionId: journal.id,
              accountId: revenueId,
              side: JournalSide.CREDIT,
              amountAtomic: new Prisma.Decimal('4'),
            },
          ],
        });
      }),
    ).rejects.toThrow(
      'journal transaction must contain at least two balanced lines',
    );
  });

  it('rejects a zero-line journal at the deferred database constraint', async () => {
    await expect(
      prisma.journalTransaction.create({
        data: {
          organizationId,
          assetId,
          reference: `direct-empty:${suffix}`,
          requestDigest: '1'.repeat(64),
          description: 'Empty database constraint fixture',
        },
      }),
    ).rejects.toThrow(
      'journal transaction must contain at least two balanced lines',
    );
  });
});
