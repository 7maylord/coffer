import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { OperationsError, type AuditEventView } from './operations.types.js';
import type { FinanceAgentTimelineStep } from './operations.types.js';

const pendingStatuses = [
  PaymentStatus.CREATED,
  PaymentStatus.QUOTED,
  PaymentStatus.AWAITING_AUTHORIZATION,
  PaymentStatus.AWAITING_DEPOSIT,
  PaymentStatus.DEPOSIT_OBSERVED,
  PaymentStatus.PROCESSING,
  PaymentStatus.REFUND_PENDING,
] as const;

@Injectable()
export class PrismaOperationsStore implements OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async audit(
    organizationId: string,
    input: { limit: number; cursor?: string; eventType?: string },
  ) {
    let beforeSequence: number | undefined;
    if (input.cursor) {
      const cursor = await this.prisma.auditEvent.findFirst({
        where: { id: input.cursor, organizationId },
        select: { sequence: true },
      });
      if (!cursor) {
        throw new OperationsError(
          'OPERATIONS_NOT_FOUND',
          'Audit cursor was not found',
        );
      }
      beforeSequence = cursor.sequence;
    }
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        organizationId,
        eventType: input.eventType,
        sequence: beforeSequence ? { lt: beforeSequence } : undefined,
      },
      orderBy: { sequence: 'desc' },
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    return {
      events: page.map(mapAuditEvent),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      integrity: await this.integrity(organizationId),
    };
  }

  async dashboard(organizationId: string, limit: number, now = new Date()) {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const attemptSelect = {
      id: true,
      provider: true,
      status: true,
      version: true,
      pollCount: true,
      createdAt: true,
      updatedAt: true,
      reconciliationCase: {
        select: { id: true, reasonCode: true, status: true, createdAt: true },
      },
    } as const;
    const [queued, pending, stuck, refunded, completed] = await Promise.all([
      this.prisma.outboxEvent.findMany({
        where: {
          organizationId,
          publishedAt: null,
          topic: { startsWith: 'settlement.' },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          id: true,
          topic: true,
          aggregateId: true,
          attempts: true,
          availableAt: true,
          lastErrorCode: true,
          createdAt: true,
        },
      }),
      this.prisma.paymentAttempt.findMany({
        where: { organizationId, status: { in: [...pendingStatuses] } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
        select: attemptSelect,
      }),
      this.prisma.paymentAttempt.findMany({
        where: {
          organizationId,
          OR: [
            { status: PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION },
            { reconciliationCase: { status: 'OPEN' } },
            {
              status: { in: [...pendingStatuses] },
              updatedAt: { lt: staleBefore },
            },
          ],
        },
        orderBy: { updatedAt: 'asc' },
        take: limit,
        select: attemptSelect,
      }),
      this.prisma.paymentAttempt.findMany({
        where: { organizationId, status: PaymentStatus.REFUNDED },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: attemptSelect,
      }),
      this.prisma.paymentAttempt.findMany({
        where: { organizationId, status: PaymentStatus.SETTLED },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: attemptSelect,
      }),
    ]);
    return {
      generatedAt: now.toISOString(),
      stuckThresholdSeconds: 300,
      queued: queued.map((row) => ({
        ...row,
        availableAt: row.availableAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      pending: pending.map(mapAttempt),
      stuck: stuck.map(mapAttempt),
      refunded: refunded.map(mapAttempt),
      completed: completed.map(mapAttempt),
    };
  }

  async metrics(organizationId: string, now = new Date()) {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const [groups, queued, openCases, stale, oldestQueued] = await Promise.all([
      this.prisma.paymentAttempt.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.count({
        where: {
          organizationId,
          publishedAt: null,
          topic: { startsWith: 'settlement.' },
        },
      }),
      this.prisma.reconciliationCase.count({
        where: { organizationId, status: 'OPEN' },
      }),
      this.prisma.paymentAttempt.count({
        where: {
          organizationId,
          status: { in: [...pendingStatuses] },
          updatedAt: { lt: staleBefore },
        },
      }),
      this.prisma.outboxEvent.findFirst({
        where: {
          organizationId,
          publishedAt: null,
          topic: { startsWith: 'settlement.' },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      generatedAt: now.toISOString(),
      paymentsByStatus: Object.fromEntries(
        groups.map((group) => [group.status, group._count._all]),
      ),
      queuedOutboxEvents: queued,
      openReconciliationCases: openCases,
      stalePendingPayments: stale,
      oldestQueuedAt: oldestQueued?.createdAt.toISOString() ?? null,
    };
  }

  async financeAgentRuns(organizationId: string, limit: number) {
    const runs = await this.prisma.financeAgentRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        settlementPosting: {
          select: {
            id: true,
            assetId: true,
            amountAtomic: true,
            journalId: true,
            completedAt: true,
          },
        },
        paymentAttempt: {
          select: {
            id: true,
            provider: true,
            status: true,
            updatedAt: true,
            reconciliationCase: {
              select: { reasonCode: true, status: true },
            },
          },
        },
        reservation: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            expiresAt: true,
          },
        },
        procurementPurchase: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            completedAt: true,
            financialProposal: {
              select: {
                id: true,
                status: true,
                approvalThreshold: true,
                createdAt: true,
                approvals: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    return runs.map(mapFinanceAgentRun);
  }

  async recheck(input: {
    organizationId: string;
    caseId: string;
    actorUserId: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    if (!input.idempotencyKey) {
      throw new OperationsError(
        'IDEMPOTENCY_REQUIRED',
        'Idempotency-Key is required',
      );
    }
    const operation = `RECONCILIATION_RECHECK:${input.caseId}`;
    const requestDigest = sha256(
      JSON.stringify({
        organizationId: input.organizationId,
        caseId: input.caseId,
        action: 'RECHECK_EXISTING_PAYMENT',
      }),
    );
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId: input.organizationId,
          operation,
          key: input.idempotencyKey,
        },
      },
    });
    if (existing) return replay(existing, requestDigest);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const reconciliation = await tx.reconciliationCase.findFirst({
          where: {
            id: input.caseId,
            organizationId: input.organizationId,
            status: 'OPEN',
          },
          include: { paymentAttempt: true },
        });
        if (!reconciliation) {
          throw new OperationsError(
            'OPERATIONS_NOT_FOUND',
            'Reconciliation case was not found',
          );
        }
        if (
          reconciliation.paymentAttempt.status !==
          PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION
        ) {
          throw new OperationsError(
            'RECONCILIATION_NOT_ACTIONABLE',
            'Only uncertain payments can be manually rechecked',
          );
        }
        const action = await tx.idempotencyRecord.create({
          data: {
            organizationId: input.organizationId,
            operation,
            key: input.idempotencyKey,
            requestDigest,
          },
        });
        const response = {
          actionId: action.id,
          caseId: reconciliation.id,
          paymentId: reconciliation.paymentAttemptId,
          action: 'RECHECK_EXISTING_PAYMENT' as const,
          status: 'QUEUED' as const,
          createdAt: action.createdAt.toISOString(),
        };
        await tx.outboxEvent.create({
          data: {
            organizationId: input.organizationId,
            topic: 'settlement.reconciliation.requested',
            aggregateId: `${reconciliation.paymentAttemptId}:manual:${action.id}`,
            payload: {
              paymentId: reconciliation.paymentAttemptId,
              reconciliationCaseId: reconciliation.id,
              action: 'RECHECK_EXISTING_PAYMENT',
            },
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorId: input.actorUserId,
            eventType: 'RECONCILIATION_RECHECK_REQUESTED',
            entityType: 'RECONCILIATION_CASE',
            entityId: reconciliation.id,
            correlationId: input.correlationId,
            traceId: input.correlationId,
            metadata: {
              action: 'RECHECK_EXISTING_PAYMENT',
              paymentId: reconciliation.paymentAttemptId,
            },
          },
        });
        await tx.idempotencyRecord.update({
          where: { id: action.id },
          data: { responseCode: 201, responseBody: response },
        });
        return response;
      });
    } catch (error) {
      if (known(error, 'P2002')) {
        const replayed = await this.prisma.idempotencyRecord.findUniqueOrThrow({
          where: {
            organizationId_operation_key: {
              organizationId: input.organizationId,
              operation,
              key: input.idempotencyKey,
            },
          },
        });
        return replay(replayed, requestDigest);
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async integrity(organizationId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ count: bigint; failures: bigint; headHash: string | null }>
    >(Prisma.sql`
      WITH ordered AS (
        SELECT *,
          row_number() OVER (ORDER BY "sequence") AS expected_sequence,
          lag("eventHash") OVER (ORDER BY "sequence") AS expected_previous
        FROM "AuditEvent"
        WHERE "organizationId" = ${organizationId}::uuid
      ), checked AS (
        SELECT *, coffer_audit_hash(
          "id", "organizationId", "sequence", "previousHash", "actorId",
          "eventType", "entityType", "entityId", "correlationId", "traceId",
          "metadata", "createdAt"
        ) AS expected_hash
        FROM ordered
      )
      SELECT count(*)::bigint AS count,
        count(*) FILTER (WHERE
          "sequence" <> expected_sequence
          OR "previousHash" IS DISTINCT FROM expected_previous
          OR "eventHash" <> expected_hash
        )::bigint AS failures,
        (SELECT "eventHash" FROM checked ORDER BY "sequence" DESC LIMIT 1) AS "headHash"
      FROM checked
    `);
    const result = rows[0] ?? { count: 0n, failures: 0n, headHash: null };
    return {
      verified: result.failures === 0n,
      eventCount: Number(result.count),
      headHash: result.headHash,
      algorithm: 'SHA-256',
    };
  }
}

function mapFinanceAgentRun(
  run: Prisma.FinanceAgentRunGetPayload<{
    include: {
      settlementPosting: {
        select: {
          id: true;
          assetId: true;
          amountAtomic: true;
          journalId: true;
          completedAt: true;
        };
      };
      paymentAttempt: {
        select: {
          id: true;
          provider: true;
          status: true;
          updatedAt: true;
          reconciliationCase: {
            select: { reasonCode: true; status: true };
          };
        };
      };
      reservation: {
        select: {
          id: true;
          status: true;
          createdAt: true;
          expiresAt: true;
        };
      };
      procurementPurchase: {
        select: {
          id: true;
          status: true;
          updatedAt: true;
          completedAt: true;
          financialProposal: {
            select: {
              id: true;
              status: true;
              approvalThreshold: true;
              createdAt: true;
              approvals: { select: { id: true } };
            };
          };
        };
      };
    };
  }>,
) {
  const proposal = run.procurementPurchase?.financialProposal ?? null;
  const value = {
    id: run.id,
    state: run.state,
    triggerType: run.triggerType,
    objective: run.objective,
    correlationId: run.correlationId,
    evidence: {
      invoiceId: run.invoiceId,
      paymentAttemptId: run.paymentAttemptId,
      settlementPostingId: run.settlementPostingId,
      journalId: run.settlementPosting.journalId,
    },
    inference: {
      status: run.inferenceStatus,
      provider: run.inferenceProvider,
      model: run.inferenceModel,
      attestationStatus: run.attestationStatus,
      inputDigest: run.inputDigest,
      responseDigest: run.responseDigest,
      errorCode: run.errorCode,
    },
    policy: {
      outcome: run.policyOutcome,
      reasonCodes: stringArray(run.policyReasonCodes),
      digest: run.policyDigest,
      version: run.policyVersion,
      instructionDigest: run.instructionDigest,
    },
    reservation: run.reservation
      ? {
          id: run.reservation.id,
          status: run.reservation.status,
          assetId: run.actionAssetId,
          amountAtomic: run.actionAmountAtomic?.toFixed(0) ?? null,
          expiresAt: run.reservation.expiresAt?.toISOString() ?? null,
        }
      : null,
    approvalBoundary: {
      backendSigning: false,
      mode: 'HUMAN_APPROVAL_REQUIRED' as const,
      transferExecution: 'SEEDED_FULFILMENT_ONLY' as const,
      proposalId: proposal?.id ?? null,
      proposalStatus: proposal?.status ?? 'NOT_REQUESTED',
      approvalCount: proposal?.approvals.length ?? 0,
      approvalThreshold: proposal?.approvalThreshold ?? null,
    },
    procurement: run.procurementPurchase
      ? {
          agentId: run.procurementAgentId,
          offerId: run.procurementOfferId,
          purchaseId: run.procurementPurchase.id,
          status: run.procurementPurchase.status,
          providerMode: 'SEEDED_PROTOTYPE' as const,
          liveSettlement: false,
        }
      : null,
    reconciliation: {
      paymentStatus: run.paymentAttempt.status,
      provider: run.paymentAttempt.provider,
      settlementCompletedAt:
        run.settlementPosting.completedAt?.toISOString() ?? null,
      caseStatus: run.paymentAttempt.reconciliationCase?.status ?? null,
      reasonCode: run.paymentAttempt.reconciliationCase?.reasonCode ?? null,
    },
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
  return { ...value, steps: financeAgentSteps(run, value) };
}

function financeAgentSteps(
  run: Parameters<typeof mapFinanceAgentRun>[0],
  value: {
    inference: { status: string; errorCode: string | null };
    policy: { outcome: string | null; reasonCodes: string[] };
    reservation: { status: string } | null;
    procurement: { status: string } | null;
    approvalBoundary: { proposalStatus: string };
    reconciliation: {
      paymentStatus: string;
      settlementCompletedAt: string | null;
    };
  },
): FinanceAgentTimelineStep[] {
  const inferenceStatus =
    value.inference.status === 'VERIFIED'
      ? 'COMPLETE'
      : value.inference.status === 'FAILED'
        ? 'FAILED'
        : 'PENDING';
  const policyStatus =
    value.policy.outcome === 'ALLOW'
      ? 'COMPLETE'
      : value.policy.outcome === 'DENY'
        ? 'FAILED'
        : value.policy.outcome === 'REQUIRES_APPROVAL'
          ? 'BLOCKED'
          : 'PENDING';
  const approvalStatus = value.procurement
    ? value.procurement.status === 'COMPLETED'
      ? 'COMPLETE'
      : value.approvalBoundary.proposalStatus === 'APPROVED'
        ? 'COMPLETE'
        : ['DENIED', 'FAILED'].includes(value.procurement.status)
          ? 'FAILED'
          : 'BLOCKED'
    : run.state === 'PROCUREMENT_CONFIGURATION_REQUIRED' ||
        run.state === 'PROCUREMENT_FAILED'
      ? 'FAILED'
      : 'PENDING';
  const reconciled =
    value.reconciliation.paymentStatus === 'SETTLED' &&
    value.reconciliation.settlementCompletedAt;
  return [
    {
      code: 'TRIGGER',
      status: 'COMPLETE',
      title: 'Verified invoice settlement triggered the run',
      detail: run.triggerType,
      occurredAt: run.createdAt.toISOString(),
    },
    {
      code: 'EVIDENCE',
      status:
        run.settlementPosting.completedAt && run.settlementPosting.journalId
          ? 'COMPLETE'
          : 'PENDING',
      title: 'Settlement evidence and ledger posting',
      detail: run.settlementPosting.journalId
        ? 'Balanced journal evidence linked'
        : 'Ledger evidence pending',
      occurredAt: run.settlementPosting.completedAt?.toISOString() ?? null,
    },
    {
      code: 'INFERENCE',
      status: inferenceStatus,
      title: 'Private inference verification',
      detail:
        value.inference.errorCode ??
        (value.inference.status === 'VERIFIED'
          ? run.attestationStatus
          : 'Inference pending'),
      occurredAt: run.decidedAt?.toISOString() ?? null,
    },
    {
      code: 'POLICY',
      status: policyStatus,
      title: 'Deterministic policy decision',
      detail:
        value.policy.reasonCodes.join(', ') ||
        value.policy.outcome ||
        'Policy evaluation pending',
      occurredAt: run.policyEvaluatedAt?.toISOString() ?? null,
    },
    {
      code: 'RESERVATION',
      status: value.reservation
        ? value.reservation.status === 'ACTIVE'
          ? 'COMPLETE'
          : 'BLOCKED'
        : run.state === 'RESERVATION_FAILED'
          ? 'FAILED'
          : 'PENDING',
      title: 'Internal ledger reservation',
      detail: value.reservation?.status ?? run.actionErrorCode ?? 'Not created',
      occurredAt: run.reservation?.createdAt.toISOString() ?? null,
    },
    {
      code: 'APPROVAL_BOUNDARY',
      status: approvalStatus,
      title: 'Human authorization boundary',
      detail: value.procurement
        ? `${value.approvalBoundary.proposalStatus}; seeded fulfilment only`
        : (run.actionErrorCode ?? 'No external action requested'),
      occurredAt:
        run.procurementPurchase?.financialProposal?.createdAt.toISOString() ??
        null,
    },
    {
      code: 'RECONCILIATION',
      status: reconciled
        ? 'COMPLETE'
        : value.reconciliation.paymentStatus ===
            'UNKNOWN_REQUIRES_RECONCILIATION'
          ? 'BLOCKED'
          : 'PENDING',
      title: 'Independent settlement reconciliation',
      detail: value.reconciliation.paymentStatus,
      occurredAt: reconciled
        ? value.reconciliation.settlementCompletedAt
        : run.paymentAttempt.updatedAt.toISOString(),
    },
  ];
}

function stringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 20)
    : [];
}

function mapAuditEvent(value: {
  id: string;
  sequence: number;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  traceId: string | null;
  previousHash: string | null;
  eventHash: string;
  metadata: unknown;
  createdAt: Date;
}): AuditEventView {
  return {
    id: value.id,
    sequence: value.sequence,
    actorId: value.actorId,
    eventType: value.eventType,
    entityType: value.entityType,
    entityId: value.entityId,
    correlationId: value.correlationId,
    traceId: value.traceId,
    previousHash: value.previousHash,
    eventHash: value.eventHash,
    metadata: redact(value.metadata),
    createdAt: value.createdAt.toISOString(),
  };
}

function mapAttempt(value: {
  id: string;
  provider: string;
  status: PaymentStatus;
  version: number;
  pollCount: number;
  createdAt: Date;
  updatedAt: Date;
  reconciliationCase: {
    id: string;
    reasonCode: string;
    status: string;
    createdAt: Date;
  } | null;
}) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    reconciliationCase: value.reconciliationCase
      ? {
          ...value.reconciliationCase,
          createdAt: value.reconciliationCase.createdAt.toISOString(),
        }
      : null,
  };
}

const privateKey =
  /salary|legal.?name|address|payout|secret|token|private.?key/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[REDACTED_DEPTH]';
  if (typeof value === 'string') return value.slice(0, 256);
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        privateKey.test(key) ? '[REDACTED]' : redact(item, depth + 1),
      ]),
    );
  }
  return value;
}

function replay(
  value: { requestDigest: string; responseBody: unknown },
  requestDigest: string,
) {
  if (value.requestDigest !== requestDigest) {
    throw new OperationsError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was used for a different request',
    );
  }
  return value.responseBody;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function known(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
