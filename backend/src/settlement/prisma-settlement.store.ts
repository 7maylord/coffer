import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  SettlementPostingKind,
} from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { mockStatusMap } from './mock-settlement.adapter.js';
import type {
  MockScenario,
  SettlementAttempt,
  SettlementQuote,
} from './settlement.types.js';
import { SettlementError } from './settlement.types.js';
import type {
  SettlementStore,
  VerifiedObservation,
} from './settlement.store.js';

const OPERATION = 'SETTLEMENT_INITIATE';

@Injectable()
export class PrismaSettlementStore implements SettlementStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async createQuote(quote: SettlementQuote): Promise<SettlementQuote> {
    await this.serializable(async (tx) => {
      if (quote.invoiceId) {
        await lockInvoice(tx, quote.organizationId, quote.invoiceId);
        const invoice = await tx.invoice.findFirst({
          where: { id: quote.invoiceId, organizationId: quote.organizationId },
        });
        validateInvoiceQuote(invoice, quote);
      }
      await tx.quoteSnapshot.create({
        data: {
          id: quote.id,
          organizationId: quote.organizationId,
          invoiceId: quote.invoiceId,
          provider: quote.provider,
          sourceAssetId: quote.sourceAssetId,
          destinationAssetId: quote.destinationAssetId,
          amountAtomic: new Prisma.Decimal(quote.amountAtomic),
          expectedAmountAtomic: new Prisma.Decimal(quote.expectedAmountAtomic),
          recipient: quote.recipient,
          refundTo: quote.refundTo,
          slippageBps: quote.slippageBps,
          confidentiality: quote.confidentiality,
          scenario: quote.scenario,
          requestDigest: quote.requestDigest,
          expiresAt: new Date(quote.expiresAt),
        },
      });
    });
    return quote;
  }

  async initiate(
    input: Parameters<SettlementStore['initiate']>[0],
  ): Promise<SettlementAttempt> {
    if (!input.idempotencyKey.trim()) {
      throw new SettlementError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required',
      );
    }
    try {
      return await this.serializable(async (tx) => {
        await lockOrganization(tx, input.organizationId);
        const existingKey = await tx.idempotencyRecord.findUnique({
          where: {
            organizationId_operation_key: {
              organizationId: input.organizationId,
              operation: OPERATION,
              key: input.idempotencyKey,
            },
          },
        });
        if (existingKey) {
          if (existingKey.requestDigest !== input.requestDigest) {
            throw new SettlementError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key was already used for a different request',
            );
          }
          const existing = await tx.paymentAttempt.findUnique({
            where: {
              organizationId_operation_idempotencyKey: {
                organizationId: input.organizationId,
                operation: OPERATION,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: attemptInclude,
          });
          if (!existing)
            throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
          return mapAttempt(existing);
        }

        const quote = await tx.quoteSnapshot.findFirst({
          where: { id: input.quoteId, organizationId: input.organizationId },
        });
        if (!quote)
          throw new SettlementError('QUOTE_NOT_FOUND', 'Quote not found');
        if (
          input.requiredInvoiceId &&
          quote.invoiceId !== input.requiredInvoiceId
        ) {
          throw new SettlementError(
            'INVOICE_QUOTE_MISMATCH',
            'Quote does not belong to this invoice',
          );
        }
        if (quote.expiresAt.getTime() <= input.now.getTime()) {
          throw new SettlementError('QUOTE_EXPIRED', 'Quote has expired');
        }
        if (quote.invoiceId) {
          await lockInvoice(tx, input.organizationId, quote.invoiceId);
          const invoice = await tx.invoice.findFirst({
            where: {
              id: quote.invoiceId,
              organizationId: input.organizationId,
            },
          });
          validateInvoiceQuote(invoice, {
            destinationAssetId: quote.destinationAssetId,
            expectedAmountAtomic: quote.expectedAmountAtomic.toFixed(0),
            recipient: quote.recipient,
          });
        }

        const attempt = await tx.paymentAttempt.create({
          data: {
            organizationId: input.organizationId,
            invoiceId: quote.invoiceId,
            quoteId: input.quoteId,
            operation: OPERATION,
            idempotencyKey: input.idempotencyKey,
            requestDigest: input.requestDigest,
            provider: 'mock',
            status: PaymentStatus.AWAITING_DEPOSIT,
            statusHistory: {
              create: {
                status: PaymentStatus.AWAITING_DEPOSIT,
                providerEventId: `${input.quoteId}:created`,
                observedAt: input.now,
              },
            },
          },
          include: attemptInclude,
        });
        await tx.idempotencyRecord.create({
          data: {
            organizationId: input.organizationId,
            operation: OPERATION,
            key: input.idempotencyKey,
            requestDigest: input.requestDigest,
            responseCode: 201,
            responseBody: { paymentId: attempt.id },
          },
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: input.organizationId,
            topic: 'settlement.poll.requested',
            aggregateId: `${attempt.id}:0`,
            payload: { paymentId: attempt.id, pollCount: 0 },
          },
        });
        return mapAttempt(attempt);
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        const existing = await this.prisma.paymentAttempt.findUnique({
          where: {
            organizationId_operation_idempotencyKey: {
              organizationId: input.organizationId,
              operation: OPERATION,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: attemptInclude,
        });
        if (existing) {
          if (existing.requestDigest !== input.requestDigest) {
            throw new SettlementError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key was already used for a different request',
            );
          }
          return mapAttempt(existing);
        }
        throw new SettlementError(
          'IDEMPOTENCY_CONFLICT',
          'Quote already has a payment attempt',
        );
      }
      throw error;
    }
  }

  async getAttempt(
    organizationId: string,
    paymentId: string,
  ): Promise<SettlementAttempt> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { id: paymentId, organizationId },
      include: attemptInclude,
    });
    if (!attempt)
      throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
    return mapAttempt(attempt);
  }

  async advanceMockPoll(
    input: Parameters<SettlementStore['advanceMockPoll']>[0],
  ): Promise<SettlementAttempt> {
    return this.serializable(async (tx) => {
      await lockAttempt(tx, input.organizationId, input.paymentId);
      const attempt = await findAttempt(
        tx,
        input.organizationId,
        input.paymentId,
      );
      const scenario = requireScenario(attempt.quote.scenario);
      const sequence = input.statuses[scenario];
      const position = Math.min(attempt.pollCount, sequence.length - 1);
      const providerStatus = sequence[position];
      const eventId =
        scenario === 'duplicate_callback' && position > 1
          ? `${attempt.id}:poll:1`
          : `${attempt.id}:poll:${position}`;
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { pollCount: { increment: 1 } },
      });
      return this.observeLocked(
        tx,
        attempt,
        {
          eventId,
          providerStatus,
          verified: true,
          amountAtomic: attempt.quote.expectedAmountAtomic.toFixed(0),
          assetId:
            providerStatus === 'REFUNDED'
              ? attempt.quote.sourceAssetId
              : attempt.quote.destinationAssetId,
          recipient: attempt.quote.recipient,
          refundAmountAtomic: attempt.quote.amountAtomic.toFixed(0),
        },
        input.now,
      );
    });
  }

  async observe(
    input: Parameters<SettlementStore['observe']>[0],
  ): Promise<SettlementAttempt> {
    try {
      return await this.serializable(async (tx) => {
        await lockAttempt(tx, input.organizationId, input.paymentId);
        const attempt = await findAttempt(
          tx,
          input.organizationId,
          input.paymentId,
        );
        return this.observeLocked(tx, attempt, input.observation, input.now);
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        return this.getAttempt(input.organizationId, input.paymentId);
      }
      throw error;
    }
  }

  private async observeLocked(
    tx: Prisma.TransactionClient,
    attempt: AttemptRecord,
    observation: VerifiedObservation,
    now: Date,
  ): Promise<SettlementAttempt> {
    const duplicate = await tx.settlementObservation.findUnique({
      where: {
        paymentAttemptId_providerEventId: {
          paymentAttemptId: attempt.id,
          providerEventId: observation.eventId,
        },
      },
    });
    if (duplicate) return mapAttempt(attempt);

    const exact = observation.verified && exactEvidence(attempt, observation);
    const next =
      observation.providerStatus === 'SUCCESS' && !exact
        ? PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION
        : observation.providerStatus === 'REFUNDED' && !exact
          ? PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION
          : (mockStatusMap[observation.providerStatus] as PaymentStatus);
    const payload = controlledPayload(observation);
    await tx.inboxEvent.create({
      data: {
        organizationId: attempt.organizationId,
        source: 'mock',
        externalEventId: observation.eventId,
        payload,
        processedAt: now,
      },
    });
    await tx.settlementObservation.create({
      data: {
        paymentAttemptId: attempt.id,
        providerEventId: observation.eventId,
        providerStatus: observation.providerStatus,
        verified: exact,
        controlledPayload: payload,
        observedAt: now,
      },
    });

    if (next !== attempt.status) {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: next,
          version: { increment: 1 },
          settledAt: next === PaymentStatus.SETTLED ? now : undefined,
        },
      });
      await tx.paymentStatusHistory.create({
        data: {
          paymentAttemptId: attempt.id,
          status: next,
          providerEventId: observation.eventId,
          observedAt: now,
        },
      });
    }

    if (next === PaymentStatus.SETTLED) {
      await createPosting(
        tx,
        attempt,
        SettlementPostingKind.SETTLEMENT,
        attempt.quote.destinationAssetId,
        attempt.quote.expectedAmountAtomic,
      );
      if (attempt.invoiceId && attempt.status !== PaymentStatus.SETTLED) {
        await applyInvoiceSettlement(tx, attempt, now);
      }
    } else if (next === PaymentStatus.REFUNDED) {
      await tx.refund.upsert({
        where: {
          paymentAttemptId_providerRefundId: {
            paymentAttemptId: attempt.id,
            providerRefundId: observation.eventId,
          },
        },
        create: {
          paymentAttemptId: attempt.id,
          providerRefundId: observation.eventId,
          amountAtomic: attempt.quote.amountAtomic,
          assetId: attempt.quote.sourceAssetId,
          observedAt: now,
        },
        update: {},
      });
      await createPosting(
        tx,
        attempt,
        SettlementPostingKind.REFUND,
        attempt.quote.sourceAssetId,
        attempt.quote.amountAtomic,
      );
    } else if (next === PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION) {
      await tx.reconciliationCase.upsert({
        where: { paymentAttemptId: attempt.id },
        create: {
          organizationId: attempt.organizationId,
          paymentAttemptId: attempt.id,
          reasonCode: exact
            ? 'PROVIDER_STATUS_UNKNOWN'
            : 'UNVERIFIED_TERMINAL_EVIDENCE',
        },
        update: {},
      });
      await createOutbox(
        tx,
        attempt.organizationId,
        'settlement.reconciliation.requested',
        attempt.id,
        {
          paymentId: attempt.id,
          reasonCode: exact
            ? 'PROVIDER_STATUS_UNKNOWN'
            : 'UNVERIFIED_TERMINAL_EVIDENCE',
        },
      );
    }

    if (!terminalStatuses.has(next)) {
      await createOutbox(
        tx,
        attempt.organizationId,
        'settlement.poll.requested',
        `${attempt.id}:${attempt.pollCount + 1}`,
        {
          paymentId: attempt.id,
          pollCount: attempt.pollCount + 1,
        },
      );
    }
    return mapAttempt(
      await findAttempt(tx, attempt.organizationId, attempt.id),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
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

const attemptInclude = {
  quote: true,
  statusHistory: { orderBy: { observedAt: 'asc' as const } },
  postings: true,
  refunds: true,
} as const;
const terminalStatuses = new Set<PaymentStatus>([
  PaymentStatus.SETTLED,
  PaymentStatus.REFUNDED,
  PaymentStatus.FAILED,
  PaymentStatus.EXPIRED,
  PaymentStatus.UNDERFUNDED,
  PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION,
]);
type AttemptRecord = Prisma.PaymentAttemptGetPayload<{
  include: typeof attemptInclude;
}>;

async function findAttempt(
  tx: Prisma.TransactionClient,
  organizationId: string,
  paymentId: string,
): Promise<AttemptRecord> {
  const attempt = await tx.paymentAttempt.findFirst({
    where: { id: paymentId, organizationId },
    include: attemptInclude,
  });
  if (!attempt)
    throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
  return attempt;
}

async function lockOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId}::uuid FOR UPDATE`,
  );
}

async function lockAttempt(
  tx: Prisma.TransactionClient,
  organizationId: string,
  paymentId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "PaymentAttempt" WHERE "id" = ${paymentId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`,
  );
}

async function lockInvoice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`,
  );
}

function validateInvoiceQuote(
  invoice: {
    status: InvoiceStatus;
    currency: string;
    totalAmountAtomic: Prisma.Decimal;
    verifiedReceivedAtomic: Prisma.Decimal;
    payeeDestination: string;
  } | null,
  quote: Pick<
    SettlementQuote,
    'destinationAssetId' | 'expectedAmountAtomic' | 'recipient'
  >,
): void {
  if (!invoice) {
    throw new SettlementError('INVOICE_NOT_FOUND', 'Invoice not found');
  }
  if (invoice.status !== InvoiceStatus.ISSUED) {
    throw new SettlementError('INVOICE_NOT_PAYABLE', 'Invoice is not payable');
  }
  const outstanding =
    BigInt(invoice.totalAmountAtomic.toFixed(0)) -
    BigInt(invoice.verifiedReceivedAtomic.toFixed(0));
  const amount = BigInt(quote.expectedAmountAtomic);
  if (
    quote.destinationAssetId !== invoice.currency ||
    quote.recipient !== invoice.payeeDestination ||
    amount <= 0n ||
    amount > outstanding
  ) {
    throw new SettlementError(
      'INVOICE_QUOTE_MISMATCH',
      'Quote does not match the payable invoice',
    );
  }
}

async function applyInvoiceSettlement(
  tx: Prisma.TransactionClient,
  attempt: AttemptRecord,
  now: Date,
): Promise<void> {
  const invoiceId = attempt.invoiceId!;
  await lockInvoice(tx, attempt.organizationId, invoiceId);
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId: attempt.organizationId },
  });
  if (
    !invoice ||
    (invoice.status !== InvoiceStatus.ISSUED &&
      invoice.status !== InvoiceStatus.PAID)
  ) {
    await tx.reconciliationCase.upsert({
      where: { paymentAttemptId: attempt.id },
      create: {
        organizationId: attempt.organizationId,
        paymentAttemptId: attempt.id,
        reasonCode: 'INVOICE_NOT_PAYABLE_AT_SETTLEMENT',
      },
      update: {},
    });
    await createOutbox(
      tx,
      attempt.organizationId,
      'settlement.reconciliation.requested',
      attempt.id,
      {
        paymentId: attempt.id,
        reasonCode: 'INVOICE_NOT_PAYABLE_AT_SETTLEMENT',
      },
    );
    return;
  }
  const received =
    BigInt(invoice.verifiedReceivedAtomic.toFixed(0)) +
    BigInt(attempt.quote.expectedAmountAtomic.toFixed(0));
  const total = BigInt(invoice.totalAmountAtomic.toFixed(0));
  const becomesPaid = received >= total;
  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      verifiedReceivedAtomic: new Prisma.Decimal(received.toString()),
      status: becomesPaid ? InvoiceStatus.PAID : invoice.status,
      paidAt: becomesPaid ? (invoice.paidAt ?? now) : undefined,
      version: { increment: 1 },
    },
  });
}

function mapAttempt(attempt: AttemptRecord): SettlementAttempt {
  return {
    id: attempt.id,
    organizationId: attempt.organizationId,
    quoteId: attempt.quoteId,
    ...(attempt.invoiceId ? { invoiceId: attempt.invoiceId } : {}),
    provider: 'mock',
    scenario: requireScenario(attempt.quote.scenario),
    status: attempt.status,
    version: attempt.version,
    settlementPostingCount: attempt.postings.filter(
      ({ kind }) => kind === SettlementPostingKind.SETTLEMENT,
    ).length,
    refundPostingCount: attempt.postings.filter(
      ({ kind }) => kind === SettlementPostingKind.REFUND,
    ).length,
    pollCount: attempt.pollCount,
    history: attempt.statusHistory.map((item) => ({
      status: item.status,
      observedAt: item.observedAt.toISOString(),
      eventId: item.providerEventId,
    })),
  };
}

function requireScenario(value: string | null): MockScenario {
  if (
    value &&
    [
      'success',
      'refund',
      'unknown',
      'partial_deposit',
      'expired_quote',
      'status_delay',
      'duplicate_callback',
    ].includes(value)
  )
    return value as MockScenario;
  throw new SettlementError(
    'INVALID_REQUEST',
    'Stored mock scenario is invalid',
  );
}

function exactEvidence(
  attempt: AttemptRecord,
  observation: VerifiedObservation,
): boolean {
  if (observation.providerStatus === 'SUCCESS') {
    return (
      observation.amountAtomic ===
        attempt.quote.expectedAmountAtomic.toFixed(0) &&
      observation.assetId === attempt.quote.destinationAssetId &&
      observation.recipient === attempt.quote.recipient
    );
  }
  if (observation.providerStatus === 'REFUNDED') {
    return (
      observation.refundAmountAtomic ===
        attempt.quote.amountAtomic.toFixed(0) &&
      observation.assetId === attempt.quote.sourceAssetId
    );
  }
  return observation.verified;
}

function controlledPayload(
  observation: VerifiedObservation,
): Prisma.InputJsonObject {
  return {
    providerStatus: observation.providerStatus,
    amountAtomic: observation.amountAtomic ?? null,
    refundAmountAtomic: observation.refundAmountAtomic ?? null,
    assetId: observation.assetId ?? null,
    recipient: observation.recipient ?? null,
  };
}

async function createPosting(
  tx: Prisma.TransactionClient,
  attempt: AttemptRecord,
  kind: SettlementPostingKind,
  assetId: string,
  amountAtomic: Prisma.Decimal,
): Promise<void> {
  const posting = await tx.settlementPosting.upsert({
    where: { paymentAttemptId_kind: { paymentAttemptId: attempt.id, kind } },
    create: {
      organizationId: attempt.organizationId,
      paymentAttemptId: attempt.id,
      kind,
      assetId,
      amountAtomic,
    },
    update: {},
  });
  await createOutbox(
    tx,
    attempt.organizationId,
    'settlement.posting.requested',
    posting.id,
    {
      postingId: posting.id,
      paymentId: attempt.id,
      kind,
      assetId,
      amountAtomic: amountAtomic.toFixed(0),
    },
  );
}

async function createOutbox(
  tx: Prisma.TransactionClient,
  organizationId: string,
  topic: string,
  aggregateId: string,
  payload: Prisma.InputJsonObject,
): Promise<void> {
  await tx.outboxEvent.upsert({
    where: { topic_aggregateId: { topic, aggregateId } },
    create: { organizationId, topic, aggregateId, payload },
    update: {},
  });
}

function knownPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function serializationConflict(error: unknown): boolean {
  return (
    knownPrismaError(error, 'P2034') ||
    (error instanceof Error &&
      /could not serialize|deadlock detected/i.test(error.message))
  );
}
