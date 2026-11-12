export const paymentStatuses = [
  'CREATED',
  'QUOTED',
  'AWAITING_AUTHORIZATION',
  'AWAITING_DEPOSIT',
  'DEPOSIT_OBSERVED',
  'PROCESSING',
  'SETTLED',
  'REFUND_PENDING',
  'REFUNDED',
  'FAILED',
  'EXPIRED',
  'UNDERFUNDED',
  'UNKNOWN_REQUIRES_RECONCILIATION',
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export const mockScenarios = [
  'success',
  'refund',
  'unknown',
  'partial_deposit',
  'expired_quote',
  'status_delay',
  'duplicate_callback',
] as const;

export type MockScenario = (typeof mockScenarios)[number];
export type ConfidentialityMode = 'none' | 'basic' | 'advanced';

export type QuoteRequest = {
  invoiceId?: string;
  sourceAssetId: string;
  destinationAssetId: string;
  amountAtomic: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  confidentiality: ConfidentialityMode;
  scenario: MockScenario;
};

export type SettlementQuote = QuoteRequest & {
  id: string;
  organizationId: string;
  provider: 'mock' | 'near-testnet';
  expectedAmountAtomic: string;
  expiresAt: string;
  requestDigest: string;
};

export type ProviderStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'INCOMPLETE_DEPOSIT'
  | 'REFUNDED'
  | 'FAILED'
  | 'UNKNOWN';

export type SettlementObservation = {
  eventId: string;
  providerStatus: ProviderStatus;
  verified: boolean;
};

export type StatusHistoryItem = {
  status: PaymentStatus;
  observedAt: string;
  eventId: string;
};

export type SettlementAttempt = {
  id: string;
  organizationId: string;
  quoteId: string;
  invoiceId?: string;
  provider: 'mock' | 'near-testnet';
  scenario: MockScenario;
  status: PaymentStatus;
  version: number;
  settlementPostingCount: number;
  refundPostingCount: number;
  pollCount: number;
  history: StatusHistoryItem[];
};

export type SettlementErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_ASSET'
  | 'UNSUPPORTED_ROUTE'
  | 'UNSUPPORTED_CONFIDENTIALITY'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NOT_PAYABLE'
  | 'INVOICE_QUOTE_MISMATCH'
  | 'PAYMENT_NOT_FOUND'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT';

export class SettlementError extends Error {
  constructor(
    readonly code: SettlementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SettlementError';
  }
}

export interface SettlementAdapter {
  supportedAssets(): ReadonlyArray<{
    id: string;
    chain: string;
    decimals: number;
  }>;
  createQuote(organizationId: string, request: QuoteRequest): SettlementQuote;
  initiate(
    organizationId: string,
    idempotencyKey: string,
    quoteId: string,
  ): SettlementAttempt;
  getAttempt(organizationId: string, paymentId: string): SettlementAttempt;
  poll(organizationId: string, paymentId: string): SettlementAttempt;
}
