import { readFileSync } from 'node:fs';
import { parseEnvironment } from '../config/env.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import {
  NearIntents1ClickAdapter,
  mapOneClickStatus,
} from './near-intents-1click.adapter.js';
import {
  oneClickStatuses,
  type IntentsQuoteRequest,
  type OneClickStatus,
} from './provider-adapter.types.js';

const tokensFixture = fixture('tokens.json');
const dryQuoteFixture = fixture('dry-quote.json');
const statusFixture = fixture('statuses.json');
const originAsset = 'nep141:wrap.near';
const destinationAsset =
  'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../test/fixtures/one-click/${name}`, import.meta.url),
      'utf8',
    ),
  ) as unknown;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

const enabledEnvironment = parseEnvironment({
  NEAR_INTENTS_DRY_QUOTES_ENABLED: 'true',
  NEAR_INTENTS_API_KEY: 'synthetic-api-key',
});

function quoteInput(
  overrides: Partial<IntentsQuoteRequest> = {},
): IntentsQuoteRequest {
  return {
    dry: true,
    originAsset,
    destinationAsset,
    amountAtomic: '100000000000000000000000',
    recipient: '0x1111111111111111111111111111111111111111',
    refundTo: 'payer.near',
    slippageBps: 50,
    deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    confidentiality: 'none',
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetcherFor(
  options: {
    status?: OneClickStatus;
    signatureValid?: boolean;
    malformedTokens?: unknown;
    malformedStatus?: unknown;
    requests?: Array<{ url: string; init?: RequestInit }>;
  } = {},
): {
  fetcher: typeof fetch;
  verify: (response: unknown) => boolean;
} {
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : input;
    options.requests?.push({ url, init });
    if (url.includes('/v0/tokens')) {
      return jsonResponse(options.malformedTokens ?? tokensFixture);
    }
    if (url.includes('/v0/quote')) {
      const request = JSON.parse(bodyText(init?.body)) as Record<
        string,
        unknown
      >;
      const response = cloneRecord(dryQuoteFixture);
      response.quoteRequest = request;
      if (request.dry === false) {
        const quote = response.quote as Record<string, unknown>;
        quote.depositAddress = 'deposit.near';
        quote.deadline = request.deadline;
      }
      return jsonResponse(response);
    }
    if (url.includes('/v0/status') || url.includes('/v0/deposit/submit')) {
      if (options.malformedStatus) return jsonResponse(options.malformedStatus);
      const response = cloneRecord(statusFixture);
      response.status = options.status ?? 'PENDING_DEPOSIT';
      return jsonResponse(response);
    }
    return jsonResponse({ message: 'not found' }, 404);
  }) as typeof fetch;
  return {
    fetcher,
    verify: vi.fn((_response: unknown) => options.signatureValid ?? true),
  };
}

function adapter(
  options: Parameters<typeof fetcherFor>[0] = {},
  environment = enabledEnvironment,
) {
  const mock = fetcherFor(options);
  return {
    client: new NearIntents1ClickAdapter(
      environment,
      new AssetRegistry(),
      mock.fetcher,
      mock.verify,
    ),
    ...mock,
  };
}

describe('NearIntents1ClickAdapter', () => {
  it('is disabled by default and never treats testnet assets as Intents assets', async () => {
    const disabled = adapter({}, parseEnvironment({})).client;
    await expect(disabled.discoverAssets()).rejects.toMatchObject({
      code: 'PROVIDER_DISABLED',
    });

    await expect(
      adapter().client.quote(
        quoteInput({ originAsset: 'near:testnet:native' }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROVIDER_ASSET' });
  });

  it('discovers and sanitizes current provider asset identities', async () => {
    const assets = await adapter().client.discoverAssets();
    expect(assets).toEqual([
      {
        assetId: originAsset,
        blockchain: 'near',
        symbol: 'wNEAR',
        decimals: 24,
        contractAddress: 'wrap.near',
      },
      {
        assetId: destinationAsset,
        blockchain: 'base',
        symbol: 'USDC',
        decimals: 6,
        contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      },
    ]);
    expect(JSON.stringify(assets)).not.toContain('price');
  });

  it('creates a signed dry EXACT_INPUT quote using atomic amounts', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const { client, verify } = adapter({ requests });
    const input = quoteInput();
    await expect(client.quote(input)).resolves.toMatchObject({
      provider: 'near-intents',
      dry: true,
      originAsset,
      destinationAsset,
      amountInAtomic: input.amountAtomic,
      amountOutAtomic: '269000',
      signatureVerified: true,
    });
    expect(verify).toHaveBeenCalledOnce();
    const quoteRequest = requests.find((item) =>
      item.url.endsWith('/v0/quote'),
    );
    expect(JSON.parse(bodyText(quoteRequest?.init?.body))).toMatchObject({
      dry: true,
      swapType: 'EXACT_INPUT',
      amount: input.amountAtomic,
      slippageTolerance: 50,
      depositType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      confidentiality: 'public',
    });
    expect(new Headers(quoteRequest?.init?.headers).get('x-api-key')).toBe(
      'synthetic-api-key',
    );
  });

  it('rejects signature failure, provider echo changes, and malformed responses', async () => {
    await expect(
      adapter({ signatureValid: false }).client.quote(quoteInput()),
    ).rejects.toMatchObject({ code: 'PROVIDER_SIGNATURE_INVALID' });
    await expect(
      adapter({
        malformedTokens: [{ assetId: 'missing-fields' }],
      }).client.discoverAssets(),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
    await expect(
      adapter({ malformedStatus: { status: 'MADE_UP' } }).client.pollStatus(
        'deposit.near',
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });

  it('keeps executable quotes and deposit submission behind both live flags', async () => {
    await expect(
      adapter().client.quote(quoteInput({ dry: false })),
    ).rejects.toMatchObject({ code: 'LIVE_OPERATION_DISABLED' });
    await expect(
      adapter().client.submitDepositEvidence({
        transactionHash: 'transaction-hash',
        depositAddress: 'deposit.near',
      }),
    ).rejects.toMatchObject({ code: 'LIVE_OPERATION_DISABLED' });
  });

  it.each([
    ['PENDING_DEPOSIT', 'AWAITING_DEPOSIT'],
    ['KNOWN_DEPOSIT_TX', 'DEPOSIT_OBSERVED'],
    ['PROCESSING', 'PROCESSING'],
    ['SUCCESS', 'SETTLED'],
    ['INCOMPLETE_DEPOSIT', 'UNDERFUNDED'],
    ['REFUNDED', 'REFUNDED'],
    ['FAILED', 'FAILED'],
  ] as const)('maps documented 1Click status %s', async (status, expected) => {
    expect(mapOneClickStatus(status)).toBe(expected);
    await expect(
      adapter({ status }).client.pollStatus('deposit.near'),
    ).resolves.toMatchObject({
      status,
      paymentStatus: expected,
      signatureVerified: true,
    });
  });

  it('keeps the provider status enum synchronized with all documented states', () => {
    expect(oneClickStatuses).toEqual([
      'PENDING_DEPOSIT',
      'KNOWN_DEPOSIT_TX',
      'PROCESSING',
      'SUCCESS',
      'INCOMPLETE_DEPOSIT',
      'REFUNDED',
      'FAILED',
    ]);
  });

  it('supports wet quote and deposit evidence only when separately enabled', async () => {
    const liveEnvironment = parseEnvironment({
      LIVE_TRANSFERS_ENABLED: 'true',
      NEAR_INTENTS_DRY_QUOTES_ENABLED: 'true',
      NEAR_INTENTS_WET_QUOTES_ENABLED: 'true',
    });
    const { client } = adapter({ status: 'KNOWN_DEPOSIT_TX' }, liveEnvironment);
    await expect(
      client.quote(quoteInput({ dry: false })),
    ).resolves.toMatchObject({
      dry: false,
      depositAddress: 'deposit.near',
      signatureVerified: true,
    });
    await expect(
      client.submitDepositEvidence({
        transactionHash: 'transaction-hash',
        depositAddress: 'deposit.near',
        nearSenderAccount: 'payer.near',
      }),
    ).resolves.toMatchObject({
      status: 'KNOWN_DEPOSIT_TX',
      paymentStatus: 'DEPOSIT_OBSERVED',
    });
  });
});

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('Expected JSON string body');
  return body;
}
