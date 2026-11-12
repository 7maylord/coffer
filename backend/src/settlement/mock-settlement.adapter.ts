import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  type ProviderStatus,
  type QuoteRequest,
  type SettlementAdapter,
  SettlementError,
  type SettlementAttempt,
  type SettlementObservation,
  type SettlementQuote,
} from './settlement.types.js';

type AdapterOptions = {
  now?: () => Date;
  idFactory?: (prefix: string) => string;
};

export const MOCK_SETTLEMENT_OPTIONS = Symbol('MOCK_SETTLEMENT_OPTIONS');

const assets = [
  { id: 'mock:base:usdc', chain: 'base-mock', decimals: 6 },
  { id: 'mock:near:usdc', chain: 'near-mock', decimals: 6 },
] as const;

export const mockScenarioStatuses: Record<
  SettlementAttempt['scenario'],
  ReadonlyArray<ProviderStatus>
> = {
  success: ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'],
  refund: ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'REFUNDED'],
  unknown: ['UNKNOWN'],
  partial_deposit: ['KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT'],
  expired_quote: ['PENDING_DEPOSIT'],
  status_delay: ['PENDING_DEPOSIT', 'PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS'],
  duplicate_callback: ['KNOWN_DEPOSIT_TX', 'SUCCESS', 'SUCCESS'],
};

export const mockStatusMap: Record<
  ProviderStatus,
  SettlementAttempt['status']
> = {
  PENDING_DEPOSIT: 'AWAITING_DEPOSIT',
  KNOWN_DEPOSIT_TX: 'DEPOSIT_OBSERVED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SETTLED',
  INCOMPLETE_DEPOSIT: 'UNDERFUNDED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN_REQUIRES_RECONCILIATION',
};

const clone = <T>(value: T): T => structuredClone(value);

@Injectable()
export class MockSettlementAdapter implements SettlementAdapter {
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly quotes = new Map<string, SettlementQuote>();
  private readonly attempts = new Map<string, SettlementAttempt>();
  private readonly idempotency = new Map<
    string,
    { requestDigest: string; attemptId: string }
  >();

  prepareInvoiceTransfer(): never {
    throw new SettlementError(
      'UNSUPPORTED_ROUTE',
      'Direct invoice transfers require the NEAR adapter',
    );
  }

  submitInvoiceTransfer(): never {
    throw new SettlementError(
      'UNSUPPORTED_ROUTE',
      'Direct invoice transfers require the NEAR adapter',
    );
  }
  private readonly observedEvents = new Set<string>();

  constructor(
    @Optional()
    @Inject(MOCK_SETTLEMENT_OPTIONS)
    options: AdapterOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  supportedAssets() {
    return assets;
  }

  createQuote(organizationId: string, request: QuoteRequest): SettlementQuote {
    assertMockOrganization(organizationId);
    validateMockQuoteRequest(request);

    const id = this.idFactory('quote');
    const expiresAt = new Date(this.now().getTime() + 10 * 60 * 1000);
    const requestDigest = this.digest({ organizationId, ...request });
    const quote: SettlementQuote = {
      ...request,
      id,
      organizationId,
      provider: 'mock',
      expectedAmountAtomic: request.amountAtomic,
      expiresAt: expiresAt.toISOString(),
      requestDigest,
    };
    this.quotes.set(id, quote);
    return clone(quote);
  }

  initiate(
    organizationId: string,
    idempotencyKey: string,
    quoteId: string,
    requiredInvoiceId?: string,
  ): SettlementAttempt {
    assertMockOrganization(organizationId);
    if (!idempotencyKey.trim()) {
      throw new SettlementError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required',
      );
    }

    const quote = this.quotes.get(quoteId);
    if (!quote || quote.organizationId !== organizationId) {
      throw new SettlementError('QUOTE_NOT_FOUND', 'Quote not found');
    }
    if (requiredInvoiceId && quote.invoiceId !== requiredInvoiceId) {
      throw new SettlementError(
        'INVOICE_QUOTE_MISMATCH',
        'Quote does not belong to this invoice',
      );
    }
    if (new Date(quote.expiresAt).getTime() <= this.now().getTime()) {
      throw new SettlementError('QUOTE_EXPIRED', 'Quote has expired');
    }

    const scope = `${organizationId}:SETTLEMENT_INITIATE:${idempotencyKey}`;
    const requestDigest = this.digest({ organizationId, quoteId });
    const existing = this.idempotency.get(scope);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new SettlementError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different request',
        );
      }
      return this.getAttempt(organizationId, existing.attemptId);
    }

    const id = this.idFactory('payment');
    const attempt: SettlementAttempt = {
      id,
      organizationId,
      quoteId,
      ...(quote.invoiceId ? { invoiceId: quote.invoiceId } : {}),
      provider: 'mock',
      scenario: quote.scenario,
      status: 'AWAITING_DEPOSIT',
      version: 1,
      settlementPostingCount: 0,
      refundPostingCount: 0,
      pollCount: 0,
      history: [
        {
          status: 'AWAITING_DEPOSIT',
          observedAt: this.now().toISOString(),
          eventId: `${id}:created`,
        },
      ],
    };
    this.attempts.set(id, attempt);
    this.idempotency.set(scope, { requestDigest, attemptId: id });
    return clone(attempt);
  }

  getAttempt(organizationId: string, paymentId: string): SettlementAttempt {
    const attempt = this.attempts.get(paymentId);
    if (!attempt || attempt.organizationId !== organizationId) {
      throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
    }
    return clone(attempt);
  }

  poll(organizationId: string, paymentId: string): SettlementAttempt {
    const attempt = this.mutableAttempt(organizationId, paymentId);
    const sequence = mockScenarioStatuses[attempt.scenario];
    const position = Math.min(attempt.pollCount, sequence.length - 1);
    const providerStatus = sequence[position];
    attempt.pollCount += 1;

    return this.observe(organizationId, paymentId, {
      eventId:
        attempt.scenario === 'duplicate_callback' && position > 1
          ? `${paymentId}:poll:1`
          : `${paymentId}:poll:${position}`,
      providerStatus,
      verified: true,
    });
  }

  observe(
    organizationId: string,
    paymentId: string,
    observation: SettlementObservation,
  ): SettlementAttempt {
    const attempt = this.mutableAttempt(organizationId, paymentId);
    const eventKey = `${organizationId}:${paymentId}:${observation.eventId}`;
    if (this.observedEvents.has(eventKey)) return clone(attempt);
    this.observedEvents.add(eventKey);

    const nextStatus =
      observation.providerStatus === 'SUCCESS' && !observation.verified
        ? 'UNKNOWN_REQUIRES_RECONCILIATION'
        : mockStatusMap[observation.providerStatus];

    if (nextStatus === attempt.status) return clone(attempt);

    attempt.status = nextStatus;
    attempt.version += 1;
    if (nextStatus === 'SETTLED') attempt.settlementPostingCount += 1;
    if (nextStatus === 'REFUNDED') attempt.refundPostingCount += 1;
    attempt.history.push({
      status: nextStatus,
      observedAt: this.now().toISOString(),
      eventId: observation.eventId,
    });
    return clone(attempt);
  }

  private mutableAttempt(organizationId: string, paymentId: string) {
    const attempt = this.attempts.get(paymentId);
    if (!attempt || attempt.organizationId !== organizationId) {
      throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
    }
    return attempt;
  }

  private digest(value: object) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}

export function validateMockQuoteRequest(request: QuoteRequest): void {
  const source = assets.find((asset) => asset.id === request.sourceAssetId);
  const destination = assets.find(
    (asset) => asset.id === request.destinationAssetId,
  );
  if (!source || !destination) {
    throw new SettlementError(
      'UNSUPPORTED_ASSET',
      'Use an asset returned by supportedAssets',
    );
  }
  if (source.id === destination.id) {
    throw new SettlementError(
      'UNSUPPORTED_ROUTE',
      'Source and destination must be different mock assets',
    );
  }
  if (!/^[1-9][0-9]*$/.test(request.amountAtomic)) {
    throw new SettlementError(
      'INVALID_REQUEST',
      'amountAtomic must be a positive base-10 integer string',
    );
  }
  if (!request.recipient.trim() || !request.refundTo.trim()) {
    throw new SettlementError(
      'INVALID_REQUEST',
      'recipient and refundTo are required',
    );
  }
  if (
    !Number.isInteger(request.slippageBps) ||
    request.slippageBps < 0 ||
    request.slippageBps > 1000
  ) {
    throw new SettlementError(
      'INVALID_REQUEST',
      'slippageBps must be an integer between 0 and 1000',
    );
  }
  if (request.confidentiality !== 'none') {
    throw new SettlementError(
      'UNSUPPORTED_CONFIDENTIALITY',
      'The mock adapter does not claim confidential settlement',
    );
  }
}

export function assertMockOrganization(organizationId: string): void {
  if (!organizationId.trim()) {
    throw new SettlementError('INVALID_REQUEST', 'organizationId is required');
  }
}
