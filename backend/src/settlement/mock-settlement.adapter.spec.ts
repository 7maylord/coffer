import { MockSettlementAdapter } from './mock-settlement.adapter.js';
import { SettlementError } from './settlement.types.js';

const validQuote = {
  sourceAssetId: 'mock:base:usdc',
  destinationAssetId: 'mock:near:usdc',
  amountAtomic: '12500000',
  recipient: 'merchant.near',
  refundTo: '0x1111111111111111111111111111111111111111',
  slippageBps: 50,
  confidentiality: 'none' as const,
  scenario: 'success' as const,
};

describe('MockSettlementAdapter', () => {
  const start = new Date('2026-10-26T12:00:00.000Z');
  let now = start;
  let sequence = 0;
  let adapter: MockSettlementAdapter;

  beforeEach(() => {
    now = start;
    sequence = 0;
    adapter = new MockSettlementAdapter({
      now: () => now,
      idFactory: (prefix) => `${prefix}_${++sequence}`,
    });
  });

  it('T-PAY-01 rejects an unsupported source chain or asset', () => {
    expect(() =>
      adapter.createQuote('org_1', {
        ...validQuote,
        sourceAssetId: 'ethereum:sepolia:usdc',
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_ASSET' }));
  });

  it('returns only clearly fictional mock assets', () => {
    expect(adapter.supportedAssets()).toEqual([
      { id: 'mock:base:usdc', chain: 'base-mock', decimals: 6 },
      { id: 'mock:near:usdc', chain: 'near-mock', decimals: 6 },
    ]);
  });

  it('rejects a route that does not change assets', () => {
    expect(() =>
      adapter.createQuote('org_1', {
        ...validQuote,
        destinationAssetId: validQuote.sourceAssetId,
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_ROUTE' }));
  });

  it('T-PAY-02 rejects an expired quote', () => {
    const quote = adapter.createQuote('org_1', validQuote);
    now = new Date('2026-10-26T12:11:00.000Z');

    expect(() => adapter.initiate('org_1', 'idem_1', quote.id)).toThrowError(
      expect.objectContaining({ code: 'QUOTE_EXPIRED' }),
    );
  });

  it('T-PAY-04 returns the same attempt for the same idempotent request', () => {
    const quote = adapter.createQuote('org_1', validQuote);
    const first = adapter.initiate('org_1', 'idem_1', quote.id);
    const repeated = adapter.initiate('org_1', 'idem_1', quote.id);

    expect(repeated).toEqual(first);
  });

  it('requires a non-empty idempotency key and an owned quote', () => {
    const quote = adapter.createQuote('org_1', validQuote);

    expect(() => adapter.initiate('org_1', '', quote.id)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }),
    );
    expect(() =>
      adapter.initiate('org_1', 'idem_1', 'missing-quote'),
    ).toThrowError(expect.objectContaining({ code: 'QUOTE_NOT_FOUND' }));
    expect(() => adapter.initiate('org_2', 'idem_2', quote.id)).toThrowError(
      expect.objectContaining({ code: 'QUOTE_NOT_FOUND' }),
    );
  });

  it('T-PAY-05 rejects an idempotency key reused with another payload', () => {
    const firstQuote = adapter.createQuote('org_1', validQuote);
    const secondQuote = adapter.createQuote('org_1', {
      ...validQuote,
      amountAtomic: '13000000',
    });
    adapter.initiate('org_1', 'idem_1', firstQuote.id);

    expect(() =>
      adapter.initiate('org_1', 'idem_1', secondQuote.id),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('T-PAY-06 posts settlement once under 100 repeated observations', async () => {
    const quote = adapter.createQuote('org_1', validQuote);
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.resolve().then(() =>
          adapter.observe('org_1', attempt.id, {
            eventId: 'provider-success-1',
            providerStatus: 'SUCCESS',
            verified: true,
          }),
        ),
      ),
    );

    const settled = adapter.getAttempt('org_1', attempt.id);
    expect(settled.status).toBe('SETTLED');
    expect(settled.settlementPostingCount).toBe(1);
    expect(settled.history).toHaveLength(2);
  });

  it('T-PAY-07 sends an unknown outcome to reconciliation', () => {
    const quote = adapter.createQuote('org_1', {
      ...validQuote,
      scenario: 'unknown',
    });
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    const result = adapter.poll('org_1', attempt.id);

    expect(result.status).toBe('UNKNOWN_REQUIRES_RECONCILIATION');
    expect(result.settlementPostingCount).toBe(0);
  });

  it('T-PAY-08 keeps an incomplete deposit underfunded', () => {
    const quote = adapter.createQuote('org_1', {
      ...validQuote,
      scenario: 'partial_deposit',
    });
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    adapter.poll('org_1', attempt.id);
    const result = adapter.poll('org_1', attempt.id);

    expect(result.status).toBe('UNDERFUNDED');
    expect(result.settlementPostingCount).toBe(0);
  });

  it('maps a verified provider failure without posting settlement', () => {
    const quote = adapter.createQuote('org_1', validQuote);
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    const result = adapter.observe('org_1', attempt.id, {
      eventId: 'failure-1',
      providerStatus: 'FAILED',
      verified: true,
    });

    expect(result.status).toBe('FAILED');
    expect(result.settlementPostingCount).toBe(0);
  });

  it('moves a success scenario through deposit, processing, and settlement', () => {
    const quote = adapter.createQuote('org_1', validQuote);
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    expect(adapter.poll('org_1', attempt.id).status).toBe('DEPOSIT_OBSERVED');
    expect(adapter.poll('org_1', attempt.id).status).toBe('PROCESSING');
    expect(adapter.poll('org_1', attempt.id).status).toBe('SETTLED');
  });

  it('does not append history when a delayed poll repeats the same status', () => {
    const quote = adapter.createQuote('org_1', {
      ...validQuote,
      scenario: 'status_delay',
    });
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    const first = adapter.poll('org_1', attempt.id);
    const repeated = adapter.poll('org_1', attempt.id);

    expect(first.status).toBe('AWAITING_DEPOSIT');
    expect(repeated.history).toHaveLength(1);
  });

  it('T-PAY-09 records one refund for duplicate refund observations', () => {
    const quote = adapter.createQuote('org_1', {
      ...validQuote,
      scenario: 'refund',
    });
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    adapter.observe('org_1', attempt.id, {
      eventId: 'refund-1',
      providerStatus: 'REFUNDED',
      verified: true,
    });
    adapter.observe('org_1', attempt.id, {
      eventId: 'refund-1',
      providerStatus: 'REFUNDED',
      verified: true,
    });

    const refunded = adapter.getAttempt('org_1', attempt.id);
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refundPostingCount).toBe(1);
  });

  it('T-PAY-11 does not trust an unverified SUCCESS observation', () => {
    const quote = adapter.createQuote('org_1', validQuote);
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    const result = adapter.observe('org_1', attempt.id, {
      eventId: 'unverified-success',
      providerStatus: 'SUCCESS',
      verified: false,
    });

    expect(result.status).toBe('UNKNOWN_REQUIRES_RECONCILIATION');
    expect(result.settlementPostingCount).toBe(0);
  });

  it('T-PAY-12 rejects unsupported confidentiality', () => {
    expect(() =>
      adapter.createQuote('org_1', {
        ...validQuote,
        confidentiality: 'basic',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CONFIDENTIALITY' }),
    );
  });

  it('keeps tenant-owned attempts isolated', () => {
    const quote = adapter.createQuote('org_1', validQuote);
    const attempt = adapter.initiate('org_1', 'idem_1', quote.id);

    expect(() => adapter.getAttempt('org_2', attempt.id)).toThrowError(
      expect.objectContaining({ code: 'PAYMENT_NOT_FOUND' }),
    );
  });

  it('rejects malformed atomic amounts without floating-point conversion', () => {
    expect(() =>
      adapter.createQuote('org_1', {
        ...validQuote,
        amountAtomic: '12.50',
      }),
    ).toThrowError(SettlementError);
  });

  it('rejects missing destinations and invalid slippage', () => {
    expect(() =>
      adapter.createQuote('org_1', { ...validQuote, recipient: '' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      adapter.createQuote('org_1', { ...validQuote, refundTo: '' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      adapter.createQuote('org_1', { ...validQuote, slippageBps: 10.5 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      adapter.createQuote('org_1', { ...validQuote, slippageBps: 1001 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('requires a non-empty organization id', () => {
    expect(() => adapter.createQuote('', validQuote)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });
});
