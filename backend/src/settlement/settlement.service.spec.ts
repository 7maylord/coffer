import { MockSettlementAdapter } from './mock-settlement.adapter.js';
import type { NearTestnetTransferAdapter } from './near-testnet-transfer.adapter.js';
import { SettlementService } from './settlement.service.js';
import type { SettlementStore } from './settlement.store.js';
import type { SettlementAttempt, SettlementQuote } from './settlement.types.js';

const payment: SettlementAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  invoiceId: '33333333-3333-4333-8333-333333333333',
  quoteId: '44444444-4444-4444-8444-444444444444',
  provider: 'near-testnet',
  scenario: 'success',
  status: 'AWAITING_DEPOSIT',
  version: 1,
  settlementPostingCount: 0,
  refundPostingCount: 0,
  pollCount: 0,
  history: [],
};

describe('SettlementService direct invoice transfer', () => {
  it('prepares and credits only exact independently verified evidence', async () => {
    let quote: SettlementQuote | undefined;
    const store = {
      createQuote: vi.fn(async (value: SettlementQuote) => {
        quote = value;
        return value;
      }),
      quote: vi.fn(async () => quote!),
      initiate: vi.fn(async (input) => ({
        ...payment,
        quoteId: input.quoteId,
      })),
      getAttempt: vi.fn(async () => ({
        ...payment,
        quoteId: quote!.id,
      })),
      observe: vi.fn(async () => ({ ...payment, status: 'SETTLED' as const })),
    } as unknown as SettlementStore;
    const transfers = {
      walletTransaction: vi.fn(async (input) => ({
        network: 'testnet' as const,
        signerAccountId: input.signerAccountId,
        receiverId: input.receiverAccountId,
        actions: [
          { type: 'Transfer' as const, amountAtomic: input.amountAtomic },
        ],
      })),
      verifyAndClaim: vi.fn(async (input) => ({
        ...input,
        provider: 'near-testnet' as const,
        evidenceDigest: 'a'.repeat(64),
        verifiedAt: '2026-11-12T12:00:01.000Z',
      })),
    } as unknown as NearTestnetTransferAdapter;
    const service = new SettlementService(
      store,
      new MockSettlementAdapter(),
      () => new Date('2026-11-12T12:00:00.000Z'),
      transfers,
    );
    const input = {
      organizationId: payment.organizationId,
      invoiceId: payment.invoiceId!,
      idempotencyKey: 'invoice-payment-1',
      assetId: 'near:testnet:native',
      amountAtomic: '1000000000000000000000000',
      signerAccountId: 'payer.testnet',
      receiverAccountId: 'merchant.testnet',
    };

    const prepared = await service.prepareInvoiceTransfer(input);
    expect(prepared.transaction).toMatchObject({
      signerAccountId: 'payer.testnet',
      receiverId: 'merchant.testnet',
    });
    expect(store.initiate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'near-testnet',
        operation: 'INVOICE_NEAR_TESTNET_TRANSFER',
        queuePoll: false,
      }),
    );

    await expect(
      service.submitInvoiceTransfer({
        organizationId: input.organizationId,
        invoiceId: input.invoiceId,
        paymentId: payment.id,
        transactionHash: '1'.repeat(43),
      }),
    ).resolves.toMatchObject({ status: 'SETTLED' });
    expect(store.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        observation: expect.objectContaining({
          providerStatus: 'SUCCESS',
          verified: true,
          amountAtomic: input.amountAtomic,
          assetId: input.assetId,
          recipient: input.receiverAccountId,
        }),
      }),
    );
  });
});
