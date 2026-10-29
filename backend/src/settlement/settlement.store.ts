import type {
  MockScenario,
  ProviderStatus,
  QuoteRequest,
  SettlementAttempt,
  SettlementObservation,
  SettlementQuote,
} from './settlement.types.js';

export type VerifiedObservation = SettlementObservation & {
  amountAtomic?: string;
  assetId?: string;
  recipient?: string;
  refundAmountAtomic?: string;
};

export interface SettlementStore {
  createQuote(quote: SettlementQuote): Promise<SettlementQuote>;
  initiate(input: {
    organizationId: string;
    idempotencyKey: string;
    quoteId: string;
    requiredInvoiceId?: string;
    requestDigest: string;
    now: Date;
  }): Promise<SettlementAttempt>;
  getAttempt(
    organizationId: string,
    paymentId: string,
  ): Promise<SettlementAttempt>;
  advanceMockPoll(input: {
    organizationId: string;
    paymentId: string;
    statuses: Readonly<Record<MockScenario, ReadonlyArray<ProviderStatus>>>;
    now: Date;
  }): Promise<SettlementAttempt>;
  observe(input: {
    organizationId: string;
    paymentId: string;
    observation: VerifiedObservation;
    now: Date;
  }): Promise<SettlementAttempt>;
}

export interface SettlementOperations {
  supportedAssets(): ReadonlyArray<{
    id: string;
    chain: string;
    decimals: number;
  }>;
  createQuote(
    organizationId: string,
    request: QuoteRequest,
  ): Promise<SettlementQuote> | SettlementQuote;
  initiate(
    organizationId: string,
    idempotencyKey: string,
    quoteId: string,
    requiredInvoiceId?: string,
  ): Promise<SettlementAttempt> | SettlementAttempt;
  getAttempt(
    organizationId: string,
    paymentId: string,
  ): Promise<SettlementAttempt> | SettlementAttempt;
  poll(
    organizationId: string,
    paymentId: string,
  ): Promise<SettlementAttempt> | SettlementAttempt;
}

export const SETTLEMENT_OPERATIONS = Symbol('SETTLEMENT_OPERATIONS');
