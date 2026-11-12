import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { NearTestnetTransferAdapter } from './near-testnet-transfer.adapter.js';
import {
  MockSettlementAdapter,
  assertMockOrganization,
  mockScenarioStatuses,
  validateMockQuoteRequest,
} from './mock-settlement.adapter.js';
import {
  SettlementError,
  type QuoteRequest,
  type SettlementAttempt,
  type SettlementQuote,
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
    private readonly transfers?: NearTestnetTransferAdapter,
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

  async prepareInvoiceTransfer(input: {
    organizationId: string;
    invoiceId: string;
    idempotencyKey: string;
    assetId: string;
    amountAtomic: string;
    signerAccountId: string;
    receiverAccountId: string;
  }) {
    if (!this.transfers) throw new Error('NEAR transfer adapter unavailable');
    const requestDigest = digest(input);
    const quote = await this.store.createQuote({
      id: uuidFromDigest(requestDigest),
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      provider: 'near-testnet',
      sourceAssetId: input.assetId,
      destinationAssetId: input.assetId,
      amountAtomic: input.amountAtomic,
      expectedAmountAtomic: input.amountAtomic,
      recipient: input.receiverAccountId,
      refundTo: input.signerAccountId,
      slippageBps: 0,
      confidentiality: 'none',
      scenario: 'success',
      expiresAt: new Date(this.now().getTime() + 10 * 60_000).toISOString(),
      requestDigest,
    });
    const payment = await this.store.initiate({
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      quoteId: quote.id,
      requiredInvoiceId: input.invoiceId,
      requestDigest,
      now: this.now(),
      provider: 'near-testnet',
      operation: 'INVOICE_NEAR_TESTNET_TRANSFER',
      queuePoll: false,
    });
    const transaction = await this.transfers.walletTransaction({
      organizationId: input.organizationId,
      referenceId: payment.id,
      network: 'testnet',
      assetId: input.assetId,
      signerAccountId: input.signerAccountId,
      receiverAccountId: input.receiverAccountId,
      amountAtomic: input.amountAtomic,
      memo: `coffer-invoice:${input.invoiceId}`,
    });
    return { payment, transaction };
  }

  async submitInvoiceTransfer(input: {
    organizationId: string;
    invoiceId: string;
    paymentId: string;
    transactionHash: string;
  }): Promise<SettlementAttempt> {
    if (!this.transfers) throw new Error('NEAR transfer adapter unavailable');
    const payment = await this.store.getAttempt(
      input.organizationId,
      input.paymentId,
    );
    if (
      payment.invoiceId !== input.invoiceId ||
      payment.provider !== 'near-testnet'
    ) {
      throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
    }
    const quote = await this.store.quote(input.organizationId, payment.quoteId);
    const evidence = await this.transfers.verifyAndClaim({
      organizationId: input.organizationId,
      referenceId: payment.id,
      network: 'testnet',
      assetId: quote.destinationAssetId,
      signerAccountId: quote.refundTo,
      receiverAccountId: quote.recipient,
      amountAtomic: quote.expectedAmountAtomic,
      memo: `coffer-invoice:${input.invoiceId}`,
      transactionHash: input.transactionHash,
    });
    return this.store.observe({
      organizationId: input.organizationId,
      paymentId: payment.id,
      observation: {
        eventId: evidence.transactionHash,
        providerStatus: 'SUCCESS',
        verified: true,
        amountAtomic: evidence.amountAtomic,
        assetId: evidence.assetId,
        recipient: evidence.receiverAccountId,
      },
      now: new Date(evidence.verifiedAt),
    });
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uuidFromDigest(value: string): string {
  const hex = `${value.slice(0, 12)}4${value.slice(13, 16)}8${value.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
