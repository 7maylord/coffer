import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { MockSettlementAdapter } from '../src/settlement/mock-settlement.adapter.js';
import { PrismaSettlementStore } from '../src/settlement/prisma-settlement.store.js';
import { SettlementService } from '../src/settlement/settlement.service.js';
import { SettlementOutboxProcessor } from '../src/settlement/settlement-outbox.processor.js';
import { PrismaLedgerStore } from '../src/treasury/prisma-ledger.store.js';
import { LedgerService } from '../src/treasury/ledger.service.js';
import { FinanceAgentOutboxProcessor } from '../src/automation/finance-agent-outbox.processor.js';
import type {
  CfoInferenceAdapter,
  CfoInferenceInput,
} from '../src/automation/automation.types.js';
import { DeterministicPolicyEngine } from '../src/policy/policy-engine.js';
import { PrismaOperationsStore } from '../src/operations/prisma-operations.store.js';

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
const unavailableAutomation = {
  requestOffer: async () => {
    throw new Error('Automation must not run in this test');
  },
  createPurchaseProposal: async () => {
    throw new Error('Automation must not run in this test');
  },
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
  let userId: string;
  let financeAgentRunId: string;
  let service: SettlementService;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: {
        slug: `settlement-${suffix}`,
        name: 'Settlement Integration Fixture',
      },
    });
    organizationId = organization.id;
    userId = (
      await prisma.user.create({
        data: { displayName: 'Settlement Integration User' },
      })
    ).id;
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

  it('AB-01 creates one durable Finance Agent run after verified invoice settlement', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        invoiceNumber: `INV-${suffix}`,
        status: 'ISSUED',
        currency: request.destinationAssetId,
        totalAmountAtomic: '250',
        publicTokenHash: `finance-agent-${suffix}`,
        payeeDestination: request.recipient,
        customer: { displayName: 'Autonomous Business Customer' },
        lineItems: [],
        metadata: {},
        dueDate: new Date('2026-11-30T00:00:00.000Z'),
        issuedAt: now,
        createdByUserId: userId,
      },
    });
    const quote = await service.createQuote(organizationId, {
      ...request,
      invoiceId: invoice.id,
      amountAtomic: '250',
    });
    const attempt = await service.initiate(
      organizationId,
      `finance-agent-${suffix}`,
      quote.id,
      invoice.id,
    );
    await store.observe({
      organizationId,
      paymentId: attempt.id,
      now,
      observation: {
        eventId: `finance-agent-settlement-${suffix}`,
        providerStatus: 'SUCCESS',
        verified: true,
        amountAtomic: '250',
        assetId: request.destinationAssetId,
        recipient: request.recipient,
      },
    });

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
          where: {
            organizationId,
            publishedAt: null,
            topic: { startsWith: 'settlement.' },
          },
        }),
      ).toBe(0);

      const run = await prisma.financeAgentRun.findUniqueOrThrow({
        where: {
          settlementPostingId: completed.find(
            ({ paymentAttemptId }) => paymentAttemptId === attempt.id,
          )!.id,
        },
      });
      financeAgentRunId = run.id;
      expect(run).toMatchObject({
        organizationId,
        invoiceId: invoice.id,
        paymentAttemptId: attempt.id,
        triggerType: 'INVOICE_SETTLED',
        objective: 'ALLOCATE_VERIFIED_INVOICE_REVENUE',
        state: 'QUEUED',
        version: 1,
        correlationId: expect.any(String),
        sourceEvidenceIds: {
          invoiceId: invoice.id,
          paymentAttemptId: attempt.id,
          settlementPostingId: run.settlementPostingId,
          journalId: expect.any(String),
        },
      });
      expect(
        await prisma.auditEvent.count({
          where: {
            organizationId,
            eventType: 'FINANCE_AGENT_RUN_CREATED',
            entityId: run.id,
          },
        }),
      ).toBe(1);

      await prisma.outboxEvent.update({
        where: {
          topic_aggregateId: {
            topic: 'settlement.posting.requested',
            aggregateId: run.settlementPostingId,
          },
        },
        data: { publishedAt: null },
      });
    } finally {
      await processor.onModuleDestroy();
    }

    const restarted = new SettlementOutboxProcessor(
      environment,
      ledger,
      service,
    );
    try {
      await expect(
        restarted.drainOnce(new Date(Date.now() + 60_000)),
      ).resolves.toBe(true);
      expect(
        await prisma.financeAgentRun.count({
          where: { paymentAttemptId: attempt.id },
        }),
      ).toBe(1);
    } finally {
      await restarted.onModuleDestroy();
    }
  });

  it('AB-02 persists only a verified, bounded Finance Agent decision once', async () => {
    const deploymentDigest = 'a'.repeat(64);
    const financeEnvironment = parseEnvironment({
      DATABASE_URL: environment.DATABASE_URL,
      AI_CFO_PROVIDER: 'near-ai',
      NEAR_AI_CFO_ENABLED: 'true',
      NEAR_AI_API_KEY: 'integration-only-key',
      NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS: deploymentDigest,
    });
    const sourceRun = await prisma.financeAgentRun.findUniqueOrThrow({
      where: { id: financeAgentRunId },
    });
    let received: CfoInferenceInput | undefined;
    const inference: CfoInferenceAdapter = {
      provider: 'near-ai-cloud',
      model: financeEnvironment.NEAR_AI_MODEL,
      infer: async (input) => {
        if (input.records[0]?.id === sourceRun.invoiceId) received = input;
        return {
          provider: 'near-ai-cloud',
          model: financeEnvironment.NEAR_AI_MODEL,
          providerRequestId: `verified-${suffix}`,
          attestationStatus: 'VERIFIED_PROVIDER_TEE',
          verificationEvidence: {
            verificationMethod: 'nearai-inference-sdk-v0.3',
            signatureKind: 'provider_tee',
            signingAlgo: 'ed25519',
            signingAddress: 'b'.repeat(64),
            deploymentDigests: [deploymentDigest],
          },
          output: {
            allocations: [
              {
                category: 'OPERATING_RESERVE',
                amountAtomic: input.maximumAmountAtomic,
                reason: 'Retain verified revenue for operating costs',
                supportingRecordIds: input.records.map(({ id }) => id),
                confidenceBps: 7500,
                uncertainty: 'Future operating costs may change',
              },
            ],
            summary: 'Retain the settled amount in operating reserve',
          },
        };
      },
    };
    const processor = new FinanceAgentOutboxProcessor(
      financeEnvironment,
      inference,
      new DeterministicPolicyEngine(),
      ledger,
      unavailableAutomation,
    );
    try {
      const processorNow = new Date(Date.now() + 60_000);
      while (
        (
          await prisma.financeAgentRun.findUniqueOrThrow({
            where: { id: financeAgentRunId },
            select: { inferenceStatus: true },
          })
        ).inferenceStatus === 'PENDING'
      ) {
        await expect(processor.drainOnce(processorNow)).resolves.toBe(true);
      }
      const run = await prisma.financeAgentRun.findUniqueOrThrow({
        where: { id: financeAgentRunId },
      });
      expect(received).toEqual({
        assetId: request.destinationAssetId,
        maximumAmountAtomic: '250',
        allowedCategories: ['OPERATING_RESERVE'],
        records: [
          expect.objectContaining({
            id: run.invoiceId,
            kind: 'invoice',
            assetId: request.destinationAssetId,
            amountAtomic: '250',
            status: 'PAID',
          }),
        ],
      });
      expect(run).toMatchObject({
        state: 'DECISION_VERIFIED',
        inferenceStatus: 'VERIFIED',
        inferenceProvider: 'near-ai-cloud',
        inferenceModel: financeEnvironment.NEAR_AI_MODEL,
        providerRequestId: `verified-${suffix}`,
        attestationStatus: 'VERIFIED_PROVIDER_TEE',
        inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        responseDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        errorCode: null,
        version: 2,
      });
      expect(run.decision).toEqual(
        expect.objectContaining({
          allocations: [expect.objectContaining({ amountAtomic: '250' })],
        }),
      );
      expect(
        await prisma.auditEvent.count({
          where: {
            organizationId,
            eventType: 'FINANCE_AGENT_RUN_STATE_CHANGED',
            entityId: run.id,
          },
        }),
      ).toBe(1);

      await prisma.outboxEvent.update({
        where: {
          topic_aggregateId: {
            topic: 'finance-agent.decision.requested',
            aggregateId: run.id,
          },
        },
        data: { publishedAt: null },
      });
    } finally {
      await processor.onModuleDestroy();
    }

    const restarted = new FinanceAgentOutboxProcessor(
      financeEnvironment,
      inference,
      new DeterministicPolicyEngine(),
      ledger,
      unavailableAutomation,
    );
    try {
      await expect(
        restarted.drainOnce(new Date(Date.now() + 60_000)),
      ).resolves.toBe(true);
      await expect(
        prisma.financeAgentRun.findUniqueOrThrow({
          where: { id: financeAgentRunId },
          select: { state: true, version: true },
        }),
      ).resolves.toEqual({ state: 'DECISION_VERIFIED', version: 2 });
    } finally {
      await restarted.onModuleDestroy();
    }
  });

  it('AB-03 applies deterministic policy and reserves an allowed action once', async () => {
    const reserveCommitment = createHash('sha256')
      .update('coffer:finance-agent:operating-reserve:v1')
      .digest('hex');
    const rules = {
      assetLimits: {
        [request.destinationAssetId]: {
          perTransactionCapAtomic: '1000',
          rollingWindowCapAtomic: '1000',
          approvalRequiredAboveAtomic: '250',
        },
      },
      allowedChainIds: ['internal:ledger'],
      allowedRecipientCommitments: [reserveCommitment],
      rollingWindowSeconds: 2_592_000,
      approvalThreshold: 2,
      agentCapsAtomic: {},
      vendorCapsAtomic: {},
      expiresAt: '2027-01-01T00:00:00.000Z',
      frozen: false,
    };
    const engine = new DeterministicPolicyEngine();
    await prisma.policyDefinition.create({
      data: {
        organizationId,
        version: 1,
        digest: engine.policyDigest(engine.normalizeRules(rules)),
        rules,
        createdByUserId: userId,
      },
    });
    const source = await prisma.ledgerAccount.findFirstOrThrow({
      where: {
        organizationId,
        assetId: request.destinationAssetId,
        code: 'SETTLEMENT_CASH',
      },
    });
    const processor = new FinanceAgentOutboxProcessor(
      parseEnvironment({ DATABASE_URL: environment.DATABASE_URL }),
      {
        provider: 'unused',
        model: 'unused/model',
        infer: async () => {
          throw new Error('Inference must not run during policy processing');
        },
      },
      engine,
      ledger,
      unavailableAutomation,
    );
    try {
      const processorNow = new Date(Date.now() + 60_000);
      while (
        (
          await prisma.financeAgentRun.findUniqueOrThrow({
            where: { id: financeAgentRunId },
            select: { state: true },
          })
        ).state === 'DECISION_VERIFIED'
      ) {
        await expect(processor.drainOnce(processorNow)).resolves.toBe(true);
      }
      const run = await prisma.financeAgentRun.findUniqueOrThrow({
        where: { id: financeAgentRunId },
      });
      expect(run).toMatchObject({
        state: 'RESERVED',
        policyOutcome: 'ALLOW',
        policyInputsDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        policyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        policyVersion: 1,
        policyReasonCodes: [],
        instructionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        actionAssetId: request.destinationAssetId,
        actionAmountAtomic: expect.objectContaining({}),
        sourceAccountId: source.id,
        reservationId: expect.any(String),
        actionErrorCode: null,
        version: 4,
      });
      expect(run.actionAmountAtomic?.toFixed(0)).toBe('250');
      expect(
        await prisma.balanceReservation.count({
          where: {
            organizationId,
            reference: `finance-agent:${run.id}`,
            amountAtomic: 250,
          },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.ledgerAccount.findUniqueOrThrow({
            where: { id: source.id },
          })
        ).reservedBalanceAtomic.toFixed(0),
      ).toBe('250');

      await prisma.outboxEvent.update({
        where: {
          topic_aggregateId: {
            topic: 'finance-agent.policy.requested',
            aggregateId: run.id,
          },
        },
        data: { publishedAt: null },
      });
      while (
        !(
          await prisma.outboxEvent.findUniqueOrThrow({
            where: {
              topic_aggregateId: {
                topic: 'finance-agent.policy.requested',
                aggregateId: run.id,
              },
            },
            select: { publishedAt: true },
          })
        ).publishedAt
      ) {
        await expect(processor.drainOnce(processorNow)).resolves.toBe(true);
      }
      await expect(
        prisma.financeAgentRun.findUniqueOrThrow({
          where: { id: run.id },
          select: { state: true, version: true },
        }),
      ).resolves.toEqual({ state: 'RESERVED', version: 4 });
      expect(
        await prisma.balanceReservation.count({
          where: { organizationId, reference: `finance-agent:${run.id}` },
        }),
      ).toBe(1);
    } finally {
      await processor.onModuleDestroy();
    }
  });

  it('AB-05 requests one bounded seeded purchase and stops for approval', async () => {
    const run = await prisma.financeAgentRun.findUniqueOrThrow({
      where: { id: financeAgentRunId },
    });
    const agent = await prisma.agentIdentity.create({
      data: {
        organizationId,
        ownerUserId: userId,
        purpose: 'Classify one settled invoice document',
        provider: 'COFFER_SCOPED_AGENT',
        allowedActions: ['purchase:document-classification'],
        assetId: run.actionAssetId!,
        chainId: 'mock:base',
        maxAmountAtomic: '200',
        rollingBudgetAtomic: '200',
        rollingWindowSeconds: 86_400,
        vendorAllowlist: ['mock-document-classifier'],
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    });
    let offerRequests = 0;
    let proposalRequests = 0;
    const automation = {
      requestOffer: async (
        requestedOrganizationId: string,
        requestedAgentId: string,
        input: {
          serviceCode: 'document-classification';
          documentCount: number;
          classificationProfile: 'standard' | 'financial';
        },
      ) => {
        offerRequests += 1;
        expect({ requestedOrganizationId, requestedAgentId, input }).toEqual({
          requestedOrganizationId: organizationId,
          requestedAgentId: agent.id,
          input: {
            serviceCode: 'document-classification',
            documentCount: 1,
            classificationProfile: 'financial',
          },
        });
        const offer = await prisma.serviceOffer.create({
          data: {
            organizationId,
            agentId: agent.id,
            vendorId: 'mock-document-classifier',
            externalOfferId: randomUUID(),
            serviceCode: 'document-classification',
            requestDigest: '1'.repeat(64),
            offerDigest: randomUUID().replaceAll('-', '').repeat(2),
            assetId: run.actionAssetId!,
            chainId: 'mock:base',
            priceAtomic: '100',
            recipientCommitment: '2'.repeat(64),
            controlledTerms: {
              documentCount: 1,
              classificationProfile: 'financial',
              deliverable: 'classification-labels',
            },
            expiresAt: new Date('2026-12-01T00:00:00.000Z'),
          },
        });
        return {
          ...offer,
          priceAtomic: offer.priceAtomic.toFixed(0),
          controlledTerms: offer.controlledTerms as {
            documentCount: number;
            classificationProfile: 'standard' | 'financial';
            deliverable: 'classification-labels';
          },
        };
      },
      createPurchaseProposal: async (
        requestedOrganizationId: string,
        requestedOwnerId: string,
        requestedAgentId: string,
        offerId: string,
      ) => {
        proposalRequests += 1;
        expect({
          requestedOrganizationId,
          requestedOwnerId,
          requestedAgentId,
        }).toEqual({
          requestedOrganizationId: organizationId,
          requestedOwnerId: userId,
          requestedAgentId: agent.id,
        });
        const purchase = await prisma.agentPurchase.create({
          data: {
            organizationId,
            agentId: agent.id,
            offerId,
            status: 'AWAITING_APPROVAL',
            requestDigest: '3'.repeat(64),
          },
        });
        return {
          ...purchase,
          status: 'AWAITING_APPROVAL' as const,
          deliverable: null,
        };
      },
    };
    await prisma.outboxEvent.upsert({
      where: {
        topic_aggregateId: {
          topic: 'finance-agent.procurement.requested',
          aggregateId: run.id,
        },
      },
      create: {
        organizationId,
        topic: 'finance-agent.procurement.requested',
        aggregateId: run.id,
        payload: { runId: run.id },
      },
      update: { publishedAt: null, availableAt: now },
    });
    const processor = new FinanceAgentOutboxProcessor(
      parseEnvironment({
        DATABASE_URL: environment.DATABASE_URL,
        FEATURE_AGENT_EXECUTION: 'true',
      }),
      {
        provider: 'unused',
        model: 'unused/model',
        infer: async () => {
          throw new Error('Inference must not run during procurement');
        },
      },
      new DeterministicPolicyEngine(),
      ledger,
      automation,
    );
    try {
      const processorNow = new Date(Date.now() + 60_000);
      await expect(processor.drainOnce(processorNow)).resolves.toBe(true);
      const procured = await prisma.financeAgentRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(procured).toMatchObject({
        state: 'PROCUREMENT_AWAITING_APPROVAL',
        procurementAgentId: agent.id,
        procurementOfferId: expect.any(String),
        procurementPurchaseId: expect.any(String),
        procurementRequestedAt: processorNow,
        actionErrorCode: null,
      });
      expect({ offerRequests, proposalRequests }).toEqual({
        offerRequests: 1,
        proposalRequests: 1,
      });

      await prisma.outboxEvent.update({
        where: {
          topic_aggregateId: {
            topic: 'finance-agent.procurement.requested',
            aggregateId: run.id,
          },
        },
        data: { publishedAt: null, availableAt: now },
      });
      await expect(processor.drainOnce(processorNow)).resolves.toBe(true);
      expect({ offerRequests, proposalRequests }).toEqual({
        offerRequests: 1,
        proposalRequests: 1,
      });
    } finally {
      await processor.onModuleDestroy();
    }
  });

  it('AB-06 exposes the evidence-bound Finance Agent timeline without signing authority', async () => {
    const operations = new PrismaOperationsStore(environment);
    try {
      const runs = await operations.financeAgentRuns(organizationId, 10);
      expect(runs[0]).toMatchObject({
        id: financeAgentRunId,
        state: 'PROCUREMENT_AWAITING_APPROVAL',
        evidence: {
          invoiceId: expect.any(String),
          settlementPostingId: expect.any(String),
          journalId: expect.any(String),
        },
        inference: {
          status: 'VERIFIED',
          attestationStatus: 'VERIFIED_PROVIDER_TEE',
        },
        policy: {
          outcome: 'ALLOW',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          instructionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        reservation: {
          status: 'ACTIVE',
          amountAtomic: '250',
        },
        approvalBoundary: {
          backendSigning: false,
          mode: 'HUMAN_APPROVAL_REQUIRED',
          transferExecution: 'SEEDED_FULFILMENT_ONLY',
          proposalStatus: 'NOT_REQUESTED',
        },
        procurement: {
          status: 'AWAITING_APPROVAL',
          providerMode: 'SEEDED_PROTOTYPE',
          liveSettlement: false,
        },
        reconciliation: {
          paymentStatus: 'SETTLED',
          settlementCompletedAt: expect.any(String),
        },
      });
      expect(runs[0]?.steps.map(({ code }) => code)).toEqual([
        'TRIGGER',
        'EVIDENCE',
        'INFERENCE',
        'POLICY',
        'RESERVATION',
        'APPROVAL_BOUNDARY',
        'RECONCILIATION',
      ]);
      await expect(
        operations.financeAgentRuns(randomUUID(), 10),
      ).resolves.toEqual([]);
    } finally {
      await operations.onModuleDestroy();
    }
  });

  it('T-AI-04/T-PRV-08 records unverified inference without changing money state', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        invoiceNumber: `UNVERIFIED-${randomUUID()}`,
        status: 'ISSUED',
        currency: request.destinationAssetId,
        totalAmountAtomic: '251',
        publicTokenHash: randomUUID().replaceAll('-', ''),
        payeeDestination: request.recipient,
        customer: { displayName: 'Unverified Inference Customer' },
        lineItems: [],
        metadata: {},
        dueDate: new Date('2026-11-30T00:00:00.000Z'),
        issuedAt: now,
        createdByUserId: userId,
      },
    });
    const quote = await service.createQuote(organizationId, {
      ...request,
      invoiceId: invoice.id,
      amountAtomic: '251',
    });
    const attempt = await service.initiate(
      organizationId,
      `unverified-${randomUUID()}`,
      quote.id,
      invoice.id,
    );
    await store.observe({
      organizationId,
      paymentId: attempt.id,
      now,
      observation: {
        eventId: `unverified-${randomUUID()}`,
        providerStatus: 'SUCCESS',
        verified: true,
        amountAtomic: '251',
        assetId: request.destinationAssetId,
        recipient: request.recipient,
      },
    });
    const settlementProcessor = new SettlementOutboxProcessor(
      environment,
      ledger,
      service,
    );
    try {
      const processorNow = new Date(Date.now() + 60_000);
      while (await settlementProcessor.drainOnce(processorNow)) {
        /* drain settlement work */
      }
    } finally {
      await settlementProcessor.onModuleDestroy();
    }
    const run = await prisma.financeAgentRun.findFirstOrThrow({
      where: { organizationId, paymentAttemptId: attempt.id },
    });
    const reservationsBefore = await prisma.balanceReservation.count({
      where: { organizationId },
    });
    const unverified: CfoInferenceAdapter = {
      provider: 'mock-cfo',
      model: 'deterministic-allocation-v1',
      infer: async (input) => ({
        provider: 'mock-cfo',
        model: 'deterministic-allocation-v1',
        attestationStatus: 'NOT_REQUESTED',
        output: {
          allocations: [
            {
              category: 'OPERATING_RESERVE',
              amountAtomic: input.maximumAmountAtomic,
              reason: 'Unverified fixture output',
              supportingRecordIds: input.records.map(({ id }) => id),
              confidenceBps: 5000,
              uncertainty: 'No verified provider evidence',
            },
          ],
          summary: 'This output must not be accepted',
        },
      }),
    };
    const processor = new FinanceAgentOutboxProcessor(
      environment,
      unverified,
      new DeterministicPolicyEngine(),
      ledger,
      unavailableAutomation,
    );
    try {
      const processorNow = new Date(Date.now() + 60_000);
      while (
        (
          await prisma.financeAgentRun.findUniqueOrThrow({
            where: { id: run.id },
            select: { inferenceStatus: true },
          })
        ).inferenceStatus === 'PENDING'
      ) {
        await expect(processor.drainOnce(processorNow)).resolves.toBe(true);
      }
    } finally {
      await processor.onModuleDestroy();
    }
    await expect(
      prisma.financeAgentRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({
      state: 'DECISION_FAILED',
      inferenceStatus: 'FAILED',
      attestationStatus: 'NOT_REQUESTED',
      decision: null,
      errorCode: 'ATTESTATION_UNVERIFIED',
      version: 2,
    });
    expect(
      await prisma.balanceReservation.count({ where: { organizationId } }),
    ).toBe(reservationsBefore);
  });
});
