import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { PrismaOperationsStore } from '../src/operations/prisma-operations.store.js';
import { MockSettlementAdapter } from '../src/settlement/mock-settlement.adapter.js';
import { PrismaSettlementStore } from '../src/settlement/prisma-settlement.store.js';
import { SettlementService } from '../src/settlement/settlement.service.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';

describe('B-10 audit and operator persistence invariants', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const settlementStore = new PrismaSettlementStore(environment);
  const settlement = new SettlementService(
    settlementStore,
    new MockSettlementAdapter(),
  );
  const operations = new PrismaOperationsStore(environment);
  const suffix = randomUUID().slice(0, 8);
  let organizationId: string;
  let otherOrganizationId: string;
  let actorUserId: string;
  let paymentId: string;
  let reconciliationCaseId: string;

  beforeAll(async () => {
    const [organization, other, actor] = await Promise.all([
      prisma.organization.create({
        data: { slug: `operations-${suffix}`, name: 'Operations Fixture' },
      }),
      prisma.organization.create({
        data: {
          slug: `operations-other-${suffix}`,
          name: 'Other Operations Fixture',
        },
      }),
      prisma.user.create({
        data: { displayName: 'Synthetic Operations User' },
      }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = other.id;
    actorUserId = actor.id;
    await prisma.membership.create({
      data: { organizationId, userId: actorUserId, role: 'FINANCE_ADMIN' },
    });
    const policy = await prisma.policyDefinition.create({
      data: {
        organizationId,
        version: 1,
        digest: 'a'.repeat(64),
        rules: {},
        createdByUserId: actorUserId,
      },
    });
    await prisma.policyDecision.create({
      data: {
        organizationId,
        policyDefinitionId: policy.id,
        actorUserId,
        outcome: 'DENY',
        reasonCodes: ['SYNTHETIC_CAP_EXCEEDED'],
        inputsDigest: 'b'.repeat(64),
        inputSummary: { classification: 'SYNTHETIC_TEST' },
      },
    });

    const quote = await settlement.createQuote(organizationId, {
      sourceAssetId: 'mock:base:usdc',
      destinationAssetId: 'mock:near:usdc',
      amountAtomic: '1000000',
      recipient: 'synthetic-merchant.near',
      refundTo: 'synthetic-payer.near',
      slippageBps: 50,
      confidentiality: 'none',
      scenario: 'unknown',
    });
    const attempt = await settlement.initiate(
      organizationId,
      `operations-${suffix}`,
      quote.id,
    );
    paymentId = attempt.id;
    await settlement.poll(organizationId, paymentId);
    reconciliationCaseId = (
      await prisma.reconciliationCase.findUniqueOrThrow({
        where: { paymentAttemptId: paymentId },
      })
    ).id;
  });

  afterAll(async () => {
    await Promise.all([
      operations.onModuleDestroy(),
      settlementStore.onModuleDestroy(),
      prisma.$disconnect(),
    ]);
  });

  it('FR-AUD-001/002 exposes a tenant-scoped, verified, immutable audit chain', async () => {
    const page = await operations.audit(organizationId, { limit: 100 });
    expect(page.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'MEMBERSHIP_PERMISSION_CREATED',
        'PAYMENT_ATTEMPT_CREATED',
        'PAYMENT_STATUS_CHANGED',
        'RECONCILIATION_CASE_OPENED',
        'POLICY_DECISION_DENIED',
      ]),
    );
    expect(page.integrity).toMatchObject({
      verified: true,
      algorithm: 'SHA-256',
    });
    expect(page.integrity.eventCount).toBeGreaterThanOrEqual(4);
    expect(page.events[0]?.eventHash).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      operations.audit(otherOrganizationId, {
        limit: 10,
        cursor: page.events[0]!.id,
      }),
    ).rejects.toMatchObject({ code: 'OPERATIONS_NOT_FOUND' });
    await expect(
      prisma.auditEvent.update({
        where: { id: page.events[0]!.id },
        data: { entityId: 'tampered' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.auditEvent.delete({ where: { id: page.events[0]!.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('FR-AUD-003 classifies queued, pending, stuck, refunded, and completed states', async () => {
    const dashboard = await operations.dashboard(organizationId, 20);
    expect(dashboard.stuck).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paymentId,
          status: 'UNKNOWN_REQUIRES_RECONCILIATION',
          reconciliationCase: expect.objectContaining({
            id: reconciliationCaseId,
            status: 'OPEN',
          }),
        }),
      ]),
    );
    expect(dashboard.queued.length).toBeGreaterThan(0);
    const metrics = await operations.metrics(organizationId);
    expect(metrics.openReconciliationCases).toBeGreaterThanOrEqual(1);
    expect(metrics.paymentsByStatus).toMatchObject({
      UNKNOWN_REQUIRES_RECONCILIATION: 1,
    });
    await expect(
      operations.dashboard(otherOrganizationId, 20),
    ).resolves.toMatchObject({
      queued: [],
      pending: [],
      stuck: [],
      refunded: [],
      completed: [],
    });
  });

  it('queues one idempotent recheck without creating or retrying a payment', async () => {
    const input = {
      organizationId,
      caseId: reconciliationCaseId,
      actorUserId,
      idempotencyKey: `recheck-${suffix}`,
      correlationId: randomUUID(),
    };
    const [first, repeated] = await Promise.all([
      operations.recheck(input),
      operations.recheck(input),
    ]);
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      caseId: reconciliationCaseId,
      paymentId,
      action: 'RECHECK_EXISTING_PAYMENT',
      status: 'QUEUED',
    });
    expect(
      await prisma.paymentAttempt.count({ where: { id: paymentId } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: {
          organizationId,
          topic: 'settlement.reconciliation.requested',
          aggregateId: { contains: ':manual:' },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          organizationId,
          eventType: 'RECONCILIATION_RECHECK_REQUESTED',
          entityId: reconciliationCaseId,
        },
      }),
    ).toBe(1);
  });
});
