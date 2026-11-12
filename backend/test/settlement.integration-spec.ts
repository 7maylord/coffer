import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { MockSettlementAdapter } from '../src/settlement/mock-settlement.adapter.js';
import { PrismaSettlementStore } from '../src/settlement/prisma-settlement.store.js';
import { SettlementService } from '../src/settlement/settlement.service.js';
import { SettlementOutboxProcessor } from '../src/settlement/settlement-outbox.processor.js';
import { PrismaLedgerStore } from '../src/treasury/prisma-ledger.store.js';
import { LedgerService } from '../src/treasury/ledger.service.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const request = {
  sourceAssetId: 'mock:base:usdc',
  destinationAssetId: 'mock:near:usdc',
  amountAtomic: '12500000',
  recipient: 'merchant.near',
  refundTo: 'payer.near',
  slippageBps: 50,
  confidentiality: 'none' as const,
  scenario: 'success' as const,
};

describe('durable settlement', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaSettlementStore(environment);
  const ledgerStore = new PrismaLedgerStore(environment);
  const ledger = new LedgerService(ledgerStore);
  const suffix = randomUUID().slice(0, 8);
  let now = new Date('2026-10-30T12:00:00.000Z');
  let organizationId: string;
  let service: SettlementService;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: {
        slug: `settlement-${suffix}`,
        name: 'Settlement Integration Fixture',
      },
    });
    organizationId = organization.id;
    service = new SettlementService(
      store,
      new MockSettlementAdapter({ now: () => now }),
      () => now,
    );
  });

  afterAll(async () => {
    await Promise.all([
      store.onModuleDestroy(),
      ledgerStore.onModuleDestroy(),
      prisma.$disconnect(),
    ]);
  });

  it('T-PAY-02/04/05 persists quote expiry and idempotency across service instances', async () => {
    const quote = await service.createQuote(organizationId, request);
    const first = await service.initiate(
      organizationId,
      `idem-${suffix}`,
      quote.id,
    );
    const restartedStore = new PrismaSettlementStore(environment);
    const restarted = new SettlementService(
      restartedStore,
      new MockSettlementAdapter({ now: () => now }),
      () => now,
    );
    try {
      await expect(
        restarted.initiate(organizationId, `idem-${suffix}`, quote.id),
      ).resolves.toEqual(first);
      const changed = await service.createQuote(organizationId, {
        ...request,
        amountAtomic: '2',
      });
      await expect(
        restarted.initiate(organizationId, `idem-${suffix}`, changed.id),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      const expiring = await service.createQuote(organizationId, {
        ...request,
        amountAtomic: '3',
      });
      now = new Date('2026-10-30T12:11:00.000Z');
      await expect(
        restarted.initiate(organizationId, `expired-${suffix}`, expiring.id),
      ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    } finally {
      await restartedStore.onModuleDestroy();
      now = new Date('2026-10-30T12:00:00.000Z');
    }
  });

  it('T-PAY-06 accepts 100 concurrent duplicate terminal events but creates one posting', async () => {
    const quote = await service.createQuote(organizationId, {
      ...request,
      amountAtomic: '100',
    });
    const attempt = await service.initiate(
      organizationId,
      `concurrent-${suffix}`,
      quote.id,
    );
    const observation = {
      eventId: `success-${suffix}`,
      providerStatus: 'SUCCESS' as const,
      verified: true,
      amountAtomic: '100',
      assetId: request.destinationAssetId,
      recipient: request.recipient,
    };
    await Promise.all(
      Array.from({ length: 100 }, () =>
        store.observe({
          organizationId,
          paymentId: attempt.id,
          observation,
          now,
        }),
      ),
    );
    await expect(
      service.getAttempt(organizationId, attempt.id),
    ).resolves.toMatchObject({
      status: 'SETTLED',
      settlementPostingCount: 1,
    });
    expect(
      await prisma.settlementObservation.count({
        where: {
          paymentAttemptId: attempt.id,
          providerEventId: observation.eventId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.settlementPosting.count({
        where: { paymentAttemptId: attempt.id },
      }),
    ).toBe(1);
  });

  it('does not regress a terminal settlement when a late poll arrives', async () => {
    const quote = await service.createQuote(organizationId, {
      ...request,
      amountAtomic: '101',
    });
    const attempt = await service.initiate(
      organizationId,
      `terminal-${suffix}`,
      quote.id,
    );
    await store.observe({
      organizationId,
      paymentId: attempt.id,
      observation: {
        eventId: `terminal-success-${suffix}`,
        providerStatus: 'SUCCESS',
        verified: true,
        amountAtomic: '101',
        assetId: request.destinationAssetId,
        recipient: request.recipient,
      },
      now,
    });
    await store.observe({
      organizationId,
      paymentId: attempt.id,
      observation: {
        eventId: `late-processing-${suffix}`,
        providerStatus: 'PROCESSING',
        verified: true,
      },
      now,
    });
    await expect(
      service.getAttempt(organizationId, attempt.id),
    ).resolves.toMatchObject({ status: 'SETTLED', settlementPostingCount: 1 });
  });

  it('T-PAY-07/T-PAY-08/T-PAY-10/T-PAY-11 reconciles uncertainty without a second attempt or ledger credit', async () => {
    const unknownQuote = await service.createQuote(organizationId, {
      ...request,
      scenario: 'unknown',
    });
    const unknown = await service.initiate(
      organizationId,
      `unknown-${suffix}`,
      unknownQuote.id,
    );
    await expect(
      service.poll(organizationId, unknown.id),
    ).resolves.toMatchObject({
      status: 'UNKNOWN_REQUIRES_RECONCILIATION',
      settlementPostingCount: 0,
    });
    expect(
      await prisma.reconciliationCase.count({
        where: { paymentAttemptId: unknown.id },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentAttempt.count({
        where: { quoteId: unknownQuote.id },
      }),
    ).toBe(1);

    const partialQuote = await service.createQuote(organizationId, {
      ...request,
      scenario: 'partial_deposit',
    });
    const partial = await service.initiate(
      organizationId,
      `partial-${suffix}`,
      partialQuote.id,
    );
    await service.poll(organizationId, partial.id);
    await expect(
      service.poll(organizationId, partial.id),
    ).resolves.toMatchObject({
      status: 'UNDERFUNDED',
      settlementPostingCount: 0,
    });

    const falseQuote = await service.createQuote(organizationId, {
      ...request,
      amountAtomic: '900',
    });
    const falseAttempt = await service.initiate(
      organizationId,
      `false-${suffix}`,
      falseQuote.id,
    );
    await store.observe({
      organizationId,
      paymentId: falseAttempt.id,
      now,
      observation: {
        eventId: `false-success-${suffix}`,
        providerStatus: 'SUCCESS',
        verified: true,
        amountAtomic: '899',
        assetId: request.destinationAssetId,
        recipient: request.recipient,
      },
    });
    await expect(
      service.getAttempt(organizationId, falseAttempt.id),
    ).resolves.toMatchObject({
      status: 'UNKNOWN_REQUIRES_RECONCILIATION',
      settlementPostingCount: 0,
    });
  });

  it('T-PAY-09 posts a verified refund once', async () => {
    const quote = await service.createQuote(organizationId, {
      ...request,
      scenario: 'refund',
      amountAtomic: '700',
    });
    const attempt = await service.initiate(
      organizationId,
      `refund-${suffix}`,
      quote.id,
    );
    const observation = {
      eventId: `refund-event-${suffix}`,
      providerStatus: 'REFUNDED' as const,
      verified: true,
      refundAmountAtomic: '700',
      assetId: request.sourceAssetId,
    };
    await store.observe({
      organizationId,
      paymentId: attempt.id,
      observation,
      now,
    });
    await store.observe({
      organizationId,
      paymentId: attempt.id,
      observation,
      now,
    });
    await expect(
      service.getAttempt(organizationId, attempt.id),
    ).resolves.toMatchObject({ status: 'REFUNDED', refundPostingCount: 1 });
    expect(
      await prisma.refund.count({ where: { paymentAttemptId: attempt.id } }),
    ).toBe(1);
  });

  it('delivers posting outbox records to the exact-once ledger path', async () => {
    const processor = new SettlementOutboxProcessor(
      environment,
      ledger,
      service,
    );
    try {
      const processorNow = new Date(Date.now() + 60_000);
      while (await processor.drainOnce(processorNow)) {
        /* drain fixture work */
      }
      const completed = await prisma.settlementPosting.findMany({
        where: { organizationId, completedAt: { not: null } },
      });
      expect(completed.length).toBeGreaterThanOrEqual(2);
      expect(completed.every(({ journalId }) => !!journalId)).toBe(true);
      const journalCount = await prisma.journalTransaction.count({
        where: { organizationId, reference: { startsWith: 'settlement:' } },
      });
      expect(journalCount).toBe(completed.length);
      expect(
        await prisma.outboxEvent.count({
          where: { organizationId, publishedAt: null },
        }),
      ).toBe(0);
    } finally {
      await processor.onModuleDestroy();
    }
  });
});
