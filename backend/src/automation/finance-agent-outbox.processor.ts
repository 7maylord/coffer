import { createHash, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import { FinancialProposalStatus, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { DeterministicPolicyEngine } from '../policy/policy-engine.js';
import {
  canonicalProposalDigest,
  commitment,
  hex32,
} from '../policy/proposal-digest.js';
import type { ActivePolicy } from '../policy/policy.types.js';
import type { PolicyOutcome } from '../policy/policy.types.js';
import { LedgerService } from '../treasury/ledger.service.js';
import {
  InsufficientFundsError,
  LedgerConflictError,
  LedgerNotFoundError,
  LedgerValidationError,
} from '../treasury/ledger.types.js';
import {
  AutomationService,
  validateCfoDecision,
} from './automation.service.js';
import {
  AutomationError,
  CFO_INFERENCE_ADAPTER,
  type CfoInferenceAdapter,
  type CfoInferenceInput,
} from './automation.types.js';
import { MOCK_SERVICE_CODE, MOCK_VENDOR_ID } from './mock-vendor.adapter.js';

type ClaimedEvent = {
  id: string;
  organizationId: string;
  topic: string;
  payload: unknown;
  claimToken: string;
};

const payloadSchema = z.object({ runId: z.string().uuid() }).strict();
const allowedCategories = ['OPERATING_RESERVE'];
const internalChainId = 'internal:ledger';
export const FINANCE_AGENT_RESERVE_COMMITMENT = createHash('sha256')
  .update('coffer:finance-agent:operating-reserve:v1')
  .digest('hex');
const actionMaterialSchema = z
  .object({
    assetId: z.string().min(1).max(192),
    amountAtomic: z.string().regex(/^[1-9][0-9]{0,77}$/),
    sourceAccountId: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .passthrough();

@Injectable()
export class FinanceAgentOutboxProcessor implements OnModuleDestroy {
  private readonly prisma: PrismaClient;
  private stopping = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(CFO_INFERENCE_ADAPTER)
    private readonly inference: CfoInferenceAdapter,
    @Inject(DeterministicPolicyEngine)
    private readonly policyEngine: DeterministicPolicyEngine,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AutomationService)
    private readonly automation: Pick<
      AutomationService,
      'requestOffer' | 'createPurchaseProposal'
    >,
  ) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  start(): void {
    this.loop ??= this.run();
  }

  async drainOnce(now = new Date()): Promise<boolean> {
    const event = await this.claim(now);
    if (!event) return false;
    try {
      await this.process(event, now);
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          claimToken: event.claimToken,
          publishedAt: null,
        },
        data: {
          publishedAt: now,
          claimedAt: null,
          claimToken: null,
          lastErrorCode: null,
        },
      });
      return true;
    } catch (error) {
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          claimToken: event.claimToken,
          publishedAt: null,
        },
        data: {
          claimedAt: null,
          claimToken: null,
          availableAt: new Date(now.getTime() + 30_000),
          lastErrorCode:
            error instanceof z.ZodError
              ? 'INVALID_OUTBOX_PAYLOAD'
              : 'DELIVERY_FAILED',
        },
      });
      throw error;
    }
  }

  private async claim(now: Date): Promise<ClaimedEvent | null> {
    const claimToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
          AND "topic" IN (
            'finance-agent.decision.requested',
            'finance-agent.policy.requested',
            'finance-agent.procurement.requested'
          )
          AND "availableAt" <= ${now}
          AND ("claimedAt" IS NULL OR "claimedAt" < ${new Date(now.getTime() - 5 * 60_000)})
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      if (!rows[0]) return null;
      const event = await tx.outboxEvent.update({
        where: { id: rows[0].id },
        data: { claimedAt: now, claimToken, attempts: { increment: 1 } },
      });
      return { ...event, claimToken };
    });
  }

  private async process(event: ClaimedEvent, now: Date): Promise<void> {
    if (event.topic === 'finance-agent.procurement.requested') {
      await this.processProcurement(event, now);
      return;
    }
    if (event.topic === 'finance-agent.policy.requested') {
      await this.processPolicy(event, now);
      return;
    }
    await this.processDecision(event, now);
  }

  private async processDecision(event: ClaimedEvent, now: Date): Promise<void> {
    const { runId } = payloadSchema.parse(event.payload);
    const run = await this.prisma.financeAgentRun.findFirst({
      where: { id: runId, organizationId: event.organizationId },
      include: { invoice: true, settlementPosting: true },
    });
    if (!run) throw new Error('Finance Agent run not found');
    if (run.inferenceStatus !== 'PENDING') return;

    const input: CfoInferenceInput = {
      assetId: run.settlementPosting.assetId,
      maximumAmountAtomic: run.settlementPosting.amountAtomic.toFixed(0),
      allowedCategories,
      records: [
        {
          id: run.invoiceId,
          kind: 'invoice',
          assetId: run.invoice.currency,
          amountAtomic: run.invoice.totalAmountAtomic.toFixed(0),
          status: run.invoice.status,
        },
      ],
    };
    const inputDigest = digest(input);
    let result: Awaited<ReturnType<CfoInferenceAdapter['infer']>>;
    try {
      result = await this.inference.infer(input);
    } catch {
      await this.fail(run.id, now, inputDigest, 'PROVIDER_UNAVAILABLE');
      return;
    }

    const responseDigest = digest(result.output);
    const evidence = result.verificationEvidence;
    const approved = new Set(
      this.environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS,
    );
    if (
      result.provider !== 'near-ai-cloud' ||
      result.provider !== this.inference.provider ||
      result.model !== this.inference.model ||
      result.attestationStatus !== 'VERIFIED_PROVIDER_TEE' ||
      !evidence ||
      evidence.signatureKind !== 'provider_tee' ||
      evidence.signingAlgo !== 'ed25519' ||
      evidence.deploymentDigests.length === 0 ||
      evidence.deploymentDigests.some((value) => !approved.has(value))
    ) {
      await this.fail(
        run.id,
        now,
        inputDigest,
        'ATTESTATION_UNVERIFIED',
        result,
        responseDigest,
      );
      return;
    }

    const decision = validateCfoDecision(
      result.output,
      allowedCategories,
      [run.invoiceId],
      input.maximumAmountAtomic,
    );
    if (!decision) {
      await this.fail(
        run.id,
        now,
        inputDigest,
        'SCHEMA_OR_BOUNDS_INVALID',
        result,
        responseDigest,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.financeAgentRun.updateMany({
        where: {
          id: run.id,
          organizationId: run.organizationId,
          inferenceStatus: 'PENDING',
        },
        data: {
          state: 'DECISION_VERIFIED',
          inferenceStatus: 'VERIFIED',
          inferenceProvider: result.provider,
          inferenceModel: result.model,
          inputDigest,
          responseDigest,
          providerRequestId: result.providerRequestId,
          attestationStatus: result.attestationStatus,
          verificationEvidence: evidence,
          decision,
          decidedAt: now,
          version: { increment: 1 },
        },
      });
      await tx.outboxEvent.upsert({
        where: {
          topic_aggregateId: {
            topic: 'finance-agent.policy.requested',
            aggregateId: run.id,
          },
        },
        create: {
          organizationId: run.organizationId,
          topic: 'finance-agent.policy.requested',
          aggregateId: run.id,
          payload: { runId: run.id },
        },
        update: {},
      });
    });
  }

  private async processPolicy(event: ClaimedEvent, now: Date): Promise<void> {
    const { runId } = payloadSchema.parse(event.payload);
    let run = await this.prisma.financeAgentRun.findFirst({
      where: { id: runId, organizationId: event.organizationId },
    });
    if (!run) throw new Error('Finance Agent run not found');
    if (run.state === 'DECISION_VERIFIED') {
      await this.evaluatePolicy(run.id, run.organizationId, now);
      run = await this.prisma.financeAgentRun.findUniqueOrThrow({
        where: { id: run.id },
      });
    }
    if (run.state !== 'POLICY_ALLOWED') return;

    const material = actionMaterialSchema.parse(run.actionMaterial);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Organization"
          WHERE "id" = ${run.organizationId}::uuid FOR NO KEY UPDATE
        `);
        const current = await tx.financeAgentRun.findFirst({
          where: {
            id: run.id,
            organizationId: run.organizationId,
            state: 'POLICY_ALLOWED',
          },
        });
        if (!current) return;
        const policy = await tx.policyDefinition.findFirst({
          where: { organizationId: run.organizationId, supersededAt: null },
          orderBy: { version: 'desc' },
        });
        let policyCurrent = false;
        if (policy) {
          try {
            const rules = this.policyEngine.normalizeRules(policy.rules);
            policyCurrent =
              policy.version === current.policyVersion &&
              policy.digest === current.policyDigest &&
              this.policyEngine.policyDigest(rules) === policy.digest &&
              !rules.frozen &&
              Date.parse(rules.expiresAt) > now.getTime();
          } catch {
            policyCurrent = false;
          }
        }
        if (!policyCurrent) {
          await tx.financeAgentRun.update({
            where: { id: current.id },
            data: {
              state: 'POLICY_STALE',
              actionErrorCode: 'POLICY_STALE',
              version: { increment: 1 },
            },
          });
          return;
        }
        const { reservation } = await this.ledger.reserve({
          organizationId: current.organizationId,
          assetId: material.assetId,
          accountId: material.sourceAccountId,
          reference: `finance-agent:${current.id}`,
          amountAtomic: material.amountAtomic,
          expiresAt: new Date(material.expiresAt),
        });
        await tx.financeAgentRun.update({
          where: { id: current.id },
          data: {
            state: 'RESERVED',
            reservationId: reservation.id,
            actionErrorCode: null,
            version: { increment: 1 },
          },
        });
        if (this.environment.FEATURE_AGENT_EXECUTION) {
          await tx.outboxEvent.upsert({
            where: {
              topic_aggregateId: {
                topic: 'finance-agent.procurement.requested',
                aggregateId: current.id,
              },
            },
            create: {
              organizationId: current.organizationId,
              topic: 'finance-agent.procurement.requested',
              aggregateId: current.id,
              payload: { runId: current.id },
            },
            update: {},
          });
        }
      });
    } catch (error) {
      if (!reservationFailure(error)) throw error;
      await this.prisma.financeAgentRun.updateMany({
        where: {
          id: run.id,
          organizationId: run.organizationId,
          state: 'POLICY_ALLOWED',
        },
        data: {
          state: 'RESERVATION_FAILED',
          actionErrorCode: 'RESERVATION_FAILED',
          version: { increment: 1 },
        },
      });
    }
  }

  private async processProcurement(
    event: ClaimedEvent,
    now: Date,
  ): Promise<void> {
    if (!this.environment.FEATURE_AGENT_EXECUTION) return;
    const { runId } = payloadSchema.parse(event.payload);
    let run = await this.prisma.financeAgentRun.findFirst({
      where: { id: runId, organizationId: event.organizationId },
    });
    if (!run) throw new Error('Finance Agent run not found');
    if (
      run.state !== 'RESERVED' &&
      run.state !== 'PROCUREMENT_OFFER_VERIFIED'
    ) {
      return;
    }

    try {
      if (!run.procurementOfferId) {
        const candidates = await this.prisma.agentIdentity.findMany({
          where: {
            organizationId: run.organizationId,
            status: 'ACTIVE',
            revokedAt: null,
            expiresAt: { gt: now },
            assetId: run.actionAssetId ?? '__missing__',
            chainId: 'mock:base',
          },
          orderBy: { createdAt: 'asc' },
        });
        const eligible = candidates.filter(isSeededProcurementAgent);
        if (eligible.length !== 1) {
          await this.prisma.financeAgentRun.update({
            where: { id: run.id },
            data: {
              state: 'PROCUREMENT_CONFIGURATION_REQUIRED',
              actionErrorCode:
                eligible.length === 0
                  ? 'PROCUREMENT_AGENT_NOT_FOUND'
                  : 'PROCUREMENT_AGENT_AMBIGUOUS',
              version: { increment: 1 },
            },
          });
          return;
        }
        const agent = eligible[0]!;
        const offer = await this.automation.requestOffer(
          run.organizationId,
          agent.id,
          {
            serviceCode: 'document-classification',
            documentCount: 1,
            classificationProfile: 'financial',
          },
          now,
        );
        if (
          !run.actionAmountAtomic ||
          BigInt(offer.priceAtomic) > BigInt(run.actionAmountAtomic.toFixed(0))
        ) {
          throw new AutomationError(
            'PURCHASE_BUDGET_EXCEEDED',
            'Seeded offer exceeds the reserved run amount',
          );
        }
        await this.prisma.financeAgentRun.update({
          where: { id: run.id },
          data: {
            state: 'PROCUREMENT_OFFER_VERIFIED',
            procurementAgentId: agent.id,
            procurementOfferId: offer.id,
            actionErrorCode: null,
            version: { increment: 1 },
          },
        });
        run = await this.prisma.financeAgentRun.findUniqueOrThrow({
          where: { id: run.id },
        });
      }

      if (!run.procurementAgentId || !run.procurementOfferId) {
        throw new Error('Finance Agent procurement link is incomplete');
      }
      const agent = await this.prisma.agentIdentity.findFirstOrThrow({
        where: {
          id: run.procurementAgentId,
          organizationId: run.organizationId,
        },
      });
      const purchase = await this.automation.createPurchaseProposal(
        run.organizationId,
        agent.ownerUserId,
        agent.id,
        run.procurementOfferId,
        now,
      );
      await this.prisma.financeAgentRun.update({
        where: { id: run.id },
        data: {
          state: 'PROCUREMENT_AWAITING_APPROVAL',
          procurementPurchaseId: purchase.id,
          procurementRequestedAt: now,
          actionErrorCode: null,
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (
        !(error instanceof AutomationError) &&
        !(error instanceof ForbiddenException)
      ) {
        throw error;
      }
      await this.prisma.financeAgentRun.updateMany({
        where: {
          id: run.id,
          organizationId: run.organizationId,
          state: { in: ['RESERVED', 'PROCUREMENT_OFFER_VERIFIED'] },
        },
        data: {
          state: 'PROCUREMENT_FAILED',
          actionErrorCode:
            error instanceof AutomationError
              ? error.code
              : 'PROCUREMENT_POLICY_DENIED',
          version: { increment: 1 },
        },
      });
    }
  }

  private async evaluatePolicy(
    runId: string,
    organizationId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Organization"
          WHERE "id" = ${organizationId}::uuid FOR UPDATE
        `);
        const run = await tx.financeAgentRun.findFirst({
          where: {
            id: runId,
            organizationId,
            state: 'DECISION_VERIFIED',
            inferenceStatus: 'VERIFIED',
          },
          include: { settlementPosting: true },
        });
        if (!run) return;
        const amountAtomic = run.settlementPosting.amountAtomic.toFixed(0);
        const decision = validateCfoDecision(
          run.decision,
          allowedCategories,
          [run.invoiceId],
          amountAtomic,
        );
        if (!decision) throw new Error('Stored Finance Agent decision invalid');
        const source = await tx.ledgerAccount.findFirst({
          where: {
            organizationId,
            assetId: run.settlementPosting.assetId,
            code: 'SETTLEMENT_CASH',
            archivedAt: null,
          },
        });
        if (!source) throw new Error('Settlement cash account not found');

        const policyRecord = await tx.policyDefinition.findFirst({
          where: { organizationId, supersededAt: null },
          orderBy: { version: 'desc' },
        });
        let policy: ActivePolicy | null = null;
        if (policyRecord) {
          try {
            const rules = this.policyEngine.normalizeRules(policyRecord.rules);
            if (this.policyEngine.policyDigest(rules) === policyRecord.digest) {
              policy = { ...policyRecord, rules };
            }
          } catch {
            policy = null;
          }
        }
        const since = new Date(
          now.getTime() - (policy?.rules.rollingWindowSeconds ?? 60) * 1_000,
        );
        const [committedRuns, committedProposals] = await Promise.all([
          tx.financeAgentRun.findMany({
            where: {
              organizationId,
              actionAssetId: run.settlementPosting.assetId,
              policyEvaluatedAt: { gte: since },
              policyOutcome: { in: ['ALLOW', 'REQUIRES_APPROVAL'] },
            },
            select: { actionAmountAtomic: true },
          }),
          tx.financialProposal.aggregate({
            where: {
              organizationId,
              assetId: run.settlementPosting.assetId,
              createdAt: { gte: since },
              status: {
                in: [
                  FinancialProposalStatus.PENDING,
                  FinancialProposalStatus.APPROVED,
                ],
              },
            },
            _sum: { amountAtomic: true },
          }),
        ]);
        const committedAtomic =
          committedRuns.reduce(
            (total, item) =>
              total + BigInt(item.actionAmountAtomic?.toFixed(0) ?? '0'),
            0n,
          ) + BigInt(committedProposals._sum.amountAtomic?.toFixed(0) ?? '0');
        const evaluation = this.policyEngine.evaluateFailClosed(
          policy,
          {
            organizationId,
            actorId: `finance-agent:${run.id}`,
            assetId: run.settlementPosting.assetId,
            chainId: internalChainId,
            recipientCommitment: FINANCE_AGENT_RESERVE_COMMITMENT,
            amountAtomic,
            rollingCommittedAtomic: committedAtomic.toString(),
          },
          now,
        );
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
        const actionMaterial = {
          proposalType: 'finance_agent_reserve',
          revision: 1,
          chainId: internalChainId,
          assetId: run.settlementPosting.assetId,
          amountAtomic,
          authorizedMaxAtomic: amountAtomic,
          recipientCommitment: FINANCE_AGENT_RESERVE_COMMITMENT,
          expiresAt: expiresAt.toISOString(),
          operation: `finance_agent_reserve:${source.id}`,
          environment: 'internal',
          sourceAccountId: source.id,
        };
        const instructionDigest =
          evaluation.policyDigest && evaluation.policyVersion
            ? canonicalProposalDigest({
                organizationCommitment: commitment(
                  'coffer:organization:v1',
                  organizationId,
                ),
                proposalType: actionMaterial.proposalType,
                proposalId: commitment('coffer:proposal-id:v1', run.id),
                revision: 1n,
                policyVersion: BigInt(evaluation.policyVersion),
                policyDigest: hex32(evaluation.policyDigest, 'policyDigest'),
                chainId: actionMaterial.chainId,
                assetId: actionMaterial.assetId,
                amountAtomic: BigInt(amountAtomic),
                authorizedMaxAtomic: BigInt(amountAtomic),
                recipientCommitment: hex32(
                  FINANCE_AGENT_RESERVE_COMMITMENT,
                  'recipientCommitment',
                ),
                expiresAtNs: BigInt(expiresAt.getTime()) * 1_000_000n,
                nonce: commitment('coffer:finance-agent:nonce:v1', run.id),
                idempotencyKeyCommitment: commitment(
                  'coffer:finance-agent:idempotency:v1',
                  run.id,
                ),
                operation: actionMaterial.operation,
                environment: actionMaterial.environment,
              }).toString('hex')
            : null;
        const state = financeAgentPolicyState(evaluation.outcome);
        await tx.financeAgentRun.update({
          where: { id: run.id },
          data: {
            state,
            policyOutcome: evaluation.outcome,
            policyInputsDigest: evaluation.inputsDigest,
            policyDigest: evaluation.policyDigest,
            policyVersion: evaluation.policyVersion,
            policyReasonCodes: evaluation.reasonCodes,
            instructionDigest,
            actionMaterial,
            actionAssetId: actionMaterial.assetId,
            actionAmountAtomic: new Prisma.Decimal(amountAtomic),
            sourceAccountId: source.id,
            policyEvaluatedAt: now,
            version: { increment: 1 },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async fail(
    runId: string,
    now: Date,
    inputDigest: string,
    errorCode: string,
    result?: Awaited<ReturnType<CfoInferenceAdapter['infer']>>,
    responseDigest?: string,
  ): Promise<void> {
    await this.prisma.financeAgentRun.updateMany({
      where: { id: runId, inferenceStatus: 'PENDING' },
      data: {
        state: 'DECISION_FAILED',
        inferenceStatus: 'FAILED',
        inferenceProvider: result?.provider ?? this.inference.provider,
        inferenceModel: result?.model ?? this.inference.model,
        inputDigest,
        responseDigest,
        providerRequestId: result?.providerRequestId,
        attestationStatus: result?.attestationStatus ?? 'UNAVAILABLE',
        verificationEvidence: result?.verificationEvidence,
        errorCode,
        decidedAt: now,
        version: { increment: 1 },
      },
    });
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        if (!(await this.drainOnce())) await delay(1000);
      } catch {
        await delay(1000);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.loop;
    await this.prisma.$disconnect();
  }
}

export function financeAgentPolicyState(outcome: PolicyOutcome): string {
  if (outcome === 'ALLOW') return 'POLICY_ALLOWED';
  if (outcome === 'REQUIRES_APPROVAL') return 'POLICY_APPROVAL_REQUIRED';
  return 'POLICY_DENIED';
}

export function isSeededProcurementAgent(agent: {
  allowedActions: Prisma.JsonValue;
  vendorAllowlist: Prisma.JsonValue;
}): boolean {
  return (
    Array.isArray(agent.allowedActions) &&
    agent.allowedActions.length === 1 &&
    agent.allowedActions[0] === `purchase:${MOCK_SERVICE_CODE}` &&
    Array.isArray(agent.vendorAllowlist) &&
    agent.vendorAllowlist.length === 1 &&
    agent.vendorAllowlist[0] === MOCK_VENDOR_ID
  );
}

function reservationFailure(error: unknown): boolean {
  return (
    error instanceof InsufficientFundsError ||
    error instanceof LedgerConflictError ||
    error instanceof LedgerNotFoundError ||
    error instanceof LedgerValidationError
  );
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
