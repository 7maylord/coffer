import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MockSettlementAdapter,
  assertMockOrganization,
  mockScenarioStatuses,
  validateMockQuoteRequest,
} from './mock-settlement.adapter.js';
import type {
  QuoteRequest,
  SettlementAttempt,
  SettlementQuote,
} from './settlement.types.js';
import type {
  SettlementOperations,
  SettlementStore,
} from './settlement.store.js';

@Injectable()
export class SettlementService implements SettlementOperations {
  constructor(
    private readonly store: SettlementStore,
    private readonly mock: MockSettlementAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  supportedAssets() {
    return this.mock.supportedAssets();
  }

  async createQuote(
    organizationId: string,
    request: QuoteRequest,
  ): Promise<SettlementQuote> {
    assertMockOrganization(organizationId);
    validateMockQuoteRequest(request);
    const quote: SettlementQuote = {
      ...request,
      id: randomUUID(),
      organizationId,
      provider: 'mock',
      expectedAmountAtomic: request.amountAtomic,
      expiresAt: new Date(this.now().getTime() + 10 * 60 * 1000).toISOString(),
      requestDigest: digest({ organizationId, ...request }),
    };
    return this.store.createQuote(quote);
  }

  initiate(
    organizationId: string,
    idempotencyKey: string,
    quoteId: string,
    requiredInvoiceId?: string,
  ): Promise<SettlementAttempt> {
    return this.store.initiate({
      organizationId,
      idempotencyKey,
      quoteId,
      requiredInvoiceId,
      requestDigest: digest({ organizationId, quoteId, requiredInvoiceId }),
      now: this.now(),
    });
  }

  getAttempt(
    organizationId: string,
    paymentId: string,
  ): Promise<SettlementAttempt> {
    return this.store.getAttempt(organizationId, paymentId);
  }

  poll(organizationId: string, paymentId: string): Promise<SettlementAttempt> {
    return this.store.advanceMockPoll({
      organizationId,
      paymentId,
      statuses: mockScenarioStatuses,
      now: this.now(),
    });
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
