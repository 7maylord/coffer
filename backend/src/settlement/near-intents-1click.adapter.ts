import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  verifyQuoteSignature,
  type OneClickQuoteResponse,
} from '@defuse-protocol/one-click-sdk-typescript';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  AssetRegistry,
  AssetRegistryError,
} from '../treasury/asset-registry.js';
import {
  oneClickStatuses,
  ProviderAdapterError,
  type IntentsAsset,
  type IntentsQuote,
  type IntentsQuoteRequest,
  type IntentsStatus,
  type OneClickStatus,
} from './provider-adapter.types.js';

export const INTENTS_FETCH = Symbol('INTENTS_FETCH');
export const INTENTS_SIGNATURE_VERIFIER = Symbol('INTENTS_SIGNATURE_VERIFIER');

type FetchLike = typeof fetch;
type SignatureVerifier = (response: OneClickQuoteResponse) => boolean;

const atomicAmount = z
  .string()
  .max(78)
  .regex(/^[0-9]+$/);
const positiveAtomicAmount = z
  .string()
  .max(78)
  .regex(/^[1-9][0-9]*$/);
const tokenSchema = z
  .object({
    assetId: z.string().min(1).max(500),
    decimals: z.number().int().min(0).max(77),
    blockchain: z.string().min(1).max(64),
    symbol: z.string().min(1).max(64),
    contractAddress: z.string().max(500).nullable().optional(),
  })
  .passthrough();
const tokensSchema = z.array(tokenSchema).max(10_000);
const quoteRequestEchoSchema = z
  .object({
    dry: z.boolean(),
    swapType: z.literal('EXACT_INPUT'),
    slippageTolerance: z.number().int(),
    originAsset: z.string(),
    depositType: z.enum(['ORIGIN_CHAIN', 'INTENTS']),
    destinationAsset: z.string(),
    amount: positiveAtomicAmount,
    refundTo: z.string(),
    refundType: z.enum(['ORIGIN_CHAIN', 'INTENTS']),
    recipient: z.string(),
    recipientType: z.literal('DESTINATION_CHAIN'),
    deadline: z.string().datetime({ offset: true }),
    confidentiality: z.enum(['public', 'basic', 'advanced']).optional(),
  })
  .passthrough();
const quoteSchema = z
  .object({
    depositAddress: z.string().min(1).max(500).optional(),
    depositMemo: z.string().max(500).optional(),
    amountIn: positiveAtomicAmount,
    minAmountIn: atomicAmount,
    amountOut: positiveAtomicAmount,
    minAmountOut: atomicAmount,
    deadline: z.string().datetime({ offset: true }).optional(),
    timeEstimate: z.number().finite().nonnegative(),
  })
  .passthrough();
const quoteResponseSchema = z
  .object({
    correlationId: z.string().min(1).max(200),
    timestamp: z.string().datetime({ offset: true }),
    signature: z.string().min(1).max(1000),
    quoteRequest: quoteRequestEchoSchema,
    quote: quoteSchema,
  })
  .passthrough();
const transactionDetailsSchema = z
  .object({ hash: z.string().min(1).max(500) })
  .passthrough();
const swapDetailsSchema = z
  .object({
    amountIn: atomicAmount.optional(),
    amountOut: atomicAmount.optional(),
    refundedAmount: atomicAmount.optional(),
    originChainTxHashes: z.array(transactionDetailsSchema).max(100),
    destinationChainTxHashes: z.array(transactionDetailsSchema).max(100),
  })
  .passthrough();
const statusResponseSchema = z
  .object({
    correlationId: z.string().min(1).max(200),
    quoteResponse: quoteResponseSchema,
    status: z.enum(oneClickStatuses),
    updatedAt: z.string().datetime({ offset: true }),
    swapDetails: swapDetailsSchema,
  })
  .passthrough();
const tidepoolNetworks: Readonly<Record<string, string>> = {
  near: 'near-testnet',
  base: 'base-sepolia',
  arb: 'arbitrum-sepolia',
  eth: 'ethereum-sepolia',
  sol: 'solana-devnet',
  stellar: 'stellar-testnet',
  sui: 'sui-testnet',
  btc: 'bitcoin-testnet4',
  xrp: 'xrp-testnet',
};

@Injectable()
export class NearIntents1ClickAdapter {
  private readonly fetcher: FetchLike;
  private readonly signatureVerifier: SignatureVerifier;
  private discovered = new Set<string>();

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(AssetRegistry) private readonly assets: AssetRegistry,
    @Optional() @Inject(INTENTS_FETCH) fetcher?: FetchLike,
    @Optional()
    @Inject(INTENTS_SIGNATURE_VERIFIER)
    signatureVerifier?: SignatureVerifier,
  ) {
    this.fetcher = fetcher ?? fetch;
    this.signatureVerifier = signatureVerifier ?? verifyQuoteSignature;
  }

  async discoverAssets(): Promise<IntentsAsset[]> {
    this.assertDiscoveryEnabled();
    const tokens = parseProvider(
      tokensSchema,
      await this.requestJson('/v0/tokens'),
    );
    const next = new Set<string>();
    const tidepool = this.environment.NEAR_INTENTS_PROVIDER === 'tidepool';
    const sanitized = tokens.map((token) => {
      const asset: IntentsAsset = {
        assetId: token.assetId,
        blockchain: token.blockchain,
        symbol: token.symbol,
        decimals: token.decimals,
        ...(token.contractAddress
          ? { contractAddress: token.contractAddress }
          : {}),
      };
      if (next.has(asset.assetId)) {
        throw invalidResponse('Provider returned a duplicate asset ID');
      }
      try {
        const network = tidepool
          ? tidepoolNetworks[asset.blockchain]
          : `${asset.blockchain}-mainnet`;
        if (!network) throw new AssetRegistryError('Unknown testnet chain');
        this.assets.registerProviderAsset({
          assetId: asset.assetId,
          adapter: 'near-intents',
          environment: tidepool ? 'testnet' : 'mainnet',
          network,
          symbol: asset.symbol,
          decimals: asset.decimals,
          kind: 'token',
          testOnly: tidepool,
          discoverySource: 'provider',
          ...(asset.contractAddress
            ? { tokenContract: asset.contractAddress }
            : {}),
        });
      } catch (error) {
        if (error instanceof AssetRegistryError) {
          throw invalidResponse(
            'Provider asset metadata is invalid or changed',
          );
        }
        throw error;
      }
      next.add(asset.assetId);
      return asset;
    });
    this.discovered = next;
    return sanitized;
  }

  async quote(input: IntentsQuoteRequest): Promise<IntentsQuote> {
    this.assertDiscoveryEnabled();
    validateQuoteInput(input, this.environment.FEATURE_CONFIDENTIAL_SWAPS);
    if (
      !input.dry &&
      (!this.environment.NEAR_INTENTS_WET_QUOTES_ENABLED ||
        !this.environment.LIVE_TRANSFERS_ENABLED)
    ) {
      throw new ProviderAdapterError(
        'LIVE_OPERATION_DISABLED',
        'Executable 1Click quotes are disabled',
      );
    }
    await this.discoverAssets();
    if (
      !this.discovered.has(input.originAsset) ||
      !this.discovered.has(input.destinationAsset)
    ) {
      throw new ProviderAdapterError(
        'UNSUPPORTED_PROVIDER_ASSET',
        'Use current asset IDs returned by 1Click token discovery',
      );
    }
    if (input.originAsset === input.destinationAsset) {
      throw new ProviderAdapterError(
        'UNSUPPORTED_PROVIDER_ROUTE',
        'Origin and destination assets must differ',
      );
    }

    const request = providerQuoteRequest(
      input,
      this.environment.NEAR_INTENTS_PROVIDER,
    );
    const response = parseProvider(
      quoteResponseSchema,
      await this.requestJson('/v0/quote', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
    verifyQuoteEcho(response.quoteRequest, request);
    if (response.quote.amountIn !== input.amountAtomic) {
      throw invalidResponse('Provider changed the exact input amount');
    }
    const signatureVerified = this.verifySignature(response);
    if (input.dry && response.quote.depositAddress) {
      throw invalidResponse(
        'Dry quote unexpectedly returned a deposit address',
      );
    }
    if (
      !input.dry &&
      (!response.quote.depositAddress || !response.quote.deadline)
    ) {
      throw invalidResponse('Executable quote is missing deposit evidence');
    }
    return {
      provider: 'near-intents',
      dry: input.dry,
      correlationId: response.correlationId,
      timestamp: response.timestamp,
      originAsset: input.originAsset,
      destinationAsset: input.destinationAsset,
      amountInAtomic: response.quote.amountIn,
      minAmountInAtomic: response.quote.minAmountIn,
      amountOutAtomic: response.quote.amountOut,
      minAmountOutAtomic: response.quote.minAmountOut,
      timeEstimateSeconds: response.quote.timeEstimate,
      depositType: response.quoteRequest.depositType,
      refundType: response.quoteRequest.refundType,
      ...(response.quote.depositAddress
        ? { depositAddress: response.quote.depositAddress }
        : {}),
      ...(response.quote.depositMemo
        ? { depositMemo: response.quote.depositMemo }
        : {}),
      ...(response.quote.deadline ? { deadline: response.quote.deadline } : {}),
      signatureVerified,
    };
  }

  async pollStatus(
    depositAddress: string,
    depositMemo?: string,
  ): Promise<IntentsStatus> {
    this.assertDiscoveryEnabled();
    const address = z.string().trim().min(1).max(500).parse(depositAddress);
    const memo = z.string().max(500).optional().parse(depositMemo);
    const query = new URLSearchParams({ depositAddress: address });
    if (memo) query.set('depositMemo', memo);
    const response = parseProvider(
      statusResponseSchema,
      await this.requestJson(`/v0/status?${query.toString()}`),
    );
    if (response.quoteResponse.quote.depositAddress !== address) {
      throw invalidResponse(
        'Status response belongs to another deposit address',
      );
    }
    return sanitizeStatus(
      response,
      this.verifySignature(response.quoteResponse),
    );
  }

  async submitDepositEvidence(input: {
    transactionHash: string;
    depositAddress: string;
    nearSenderAccount?: string;
    memo?: string;
  }): Promise<IntentsStatus> {
    if (
      !this.environment.NEAR_INTENTS_WET_QUOTES_ENABLED ||
      !this.environment.LIVE_TRANSFERS_ENABLED
    ) {
      throw new ProviderAdapterError(
        'LIVE_OPERATION_DISABLED',
        '1Click deposit submission is disabled',
      );
    }
    const body = z
      .object({
        transactionHash: z.string().trim().min(1).max(500),
        depositAddress: z.string().trim().min(1).max(500),
        nearSenderAccount: z.string().trim().min(2).max(64).optional(),
        memo: z.string().max(500).optional(),
      })
      .strict()
      .parse(input);
    const response = parseProvider(
      statusResponseSchema,
      await this.requestJson('/v0/deposit/submit', {
        method: 'POST',
        body: JSON.stringify({
          txHash: body.transactionHash,
          depositAddress: body.depositAddress,
          ...(body.nearSenderAccount
            ? { nearSenderAccount: body.nearSenderAccount }
            : {}),
          ...(body.memo ? { memo: body.memo } : {}),
        }),
      }),
    );
    if (response.quoteResponse.quote.depositAddress !== body.depositAddress) {
      throw invalidResponse('Deposit response belongs to another quote');
    }
    return sanitizeStatus(
      response,
      this.verifySignature(response.quoteResponse),
    );
  }

  private assertDiscoveryEnabled(): void {
    if (!this.environment.NEAR_INTENTS_DRY_QUOTES_ENABLED) {
      throw new ProviderAdapterError(
        'PROVIDER_DISABLED',
        '1Click discovery and dry quotes are disabled',
      );
    }
  }

  private verifySignature(
    response: z.infer<typeof quoteResponseSchema>,
  ): boolean {
    if (this.environment.NEAR_INTENTS_PROVIDER === 'tidepool') return false;
    if (!this.signatureVerifier(response as OneClickQuoteResponse)) {
      throw new ProviderAdapterError(
        'PROVIDER_SIGNATURE_INVALID',
        '1Click response signature verification failed',
      );
    }
    return true;
  }

  private async requestJson(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const base = new URL(this.environment.NEAR_INTENTS_API_URL);
    if (base.username || base.password) {
      throw new ProviderAdapterError(
        'PROVIDER_DISABLED',
        '1Click base URL cannot contain credentials',
      );
    }
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body) headers.set('content-type', 'application/json');
    if (this.environment.NEAR_INTENTS_PROVIDER === 'one-click') {
      if (this.environment.NEAR_INTENTS_API_KEY) {
        headers.set('x-api-key', this.environment.NEAR_INTENTS_API_KEY);
      } else if (this.environment.NEAR_INTENTS_JWT) {
        headers.set(
          'authorization',
          `Bearer ${this.environment.NEAR_INTENTS_JWT}`,
        );
      }
    }
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, base), {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ProviderAdapterError(
        'PROVIDER_UNAVAILABLE',
        '1Click request failed',
      );
    }
    if (!response.ok) {
      throw new ProviderAdapterError(
        'PROVIDER_UNAVAILABLE',
        `1Click returned HTTP ${response.status}`,
      );
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) {
      throw invalidResponse('1Click response is too large');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 1_000_000) {
      throw invalidResponse('1Click response is too large');
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw invalidResponse('1Click returned malformed JSON');
    }
  }
}

type ProviderQuoteRequest = ReturnType<typeof providerQuoteRequest>;

function providerQuoteRequest(
  input: IntentsQuoteRequest,
  provider: AppEnvironment['NEAR_INTENTS_PROVIDER'],
) {
  const tidepool = provider === 'tidepool';
  return {
    dry: input.dry,
    swapType: 'EXACT_INPUT' as const,
    slippageTolerance: input.slippageBps,
    originAsset: input.originAsset,
    depositType: tidepool ? ('INTENTS' as const) : ('ORIGIN_CHAIN' as const),
    destinationAsset: input.destinationAsset,
    amount: input.amountAtomic,
    refundTo: input.refundTo,
    refundType: tidepool ? ('INTENTS' as const) : ('ORIGIN_CHAIN' as const),
    recipient: input.recipient,
    recipientType: 'DESTINATION_CHAIN' as const,
    deadline: input.deadline,
    confidentiality:
      input.confidentiality === 'none'
        ? ('public' as const)
        : input.confidentiality,
  };
}

function validateQuoteInput(
  input: IntentsQuoteRequest,
  confidentialEnabled: boolean,
): void {
  const parsed = z
    .object({
      dry: z.boolean(),
      originAsset: z.string().min(1).max(500),
      destinationAsset: z.string().min(1).max(500),
      amountAtomic: positiveAtomicAmount,
      recipient: z.string().trim().min(1).max(500),
      refundTo: z.string().trim().min(1).max(500),
      slippageBps: z.number().int().min(0).max(10_000),
      deadline: z.string().datetime({ offset: true }),
      confidentiality: z.enum(['none', 'basic', 'advanced']),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw invalidResponse('1Click quote request is invalid');
  const deadline = new Date(input.deadline).getTime();
  const now = Date.now();
  if (deadline <= now || deadline > now + 24 * 60 * 60 * 1000) {
    throw invalidResponse('1Click deadline must be within the next 24 hours');
  }
  if (input.confidentiality !== 'none' && !confidentialEnabled) {
    throw new ProviderAdapterError(
      'UNSUPPORTED_PROVIDER_CONFIDENTIALITY',
      'Confidential Intents quotes are disabled',
    );
  }
}

function verifyQuoteEcho(
  echo: z.infer<typeof quoteRequestEchoSchema>,
  request: ProviderQuoteRequest,
): void {
  for (const key of [
    'dry',
    'swapType',
    'slippageTolerance',
    'originAsset',
    'depositType',
    'destinationAsset',
    'amount',
    'refundTo',
    'refundType',
    'recipient',
    'recipientType',
    'deadline',
    'confidentiality',
  ] as const) {
    if (echo[key] !== request[key]) {
      throw invalidResponse(`1Click quote changed ${key}`);
    }
  }
}

function sanitizeStatus(
  response: z.infer<typeof statusResponseSchema>,
  signatureVerified: boolean,
): IntentsStatus {
  return {
    provider: 'near-intents',
    correlationId: response.correlationId,
    status: response.status,
    paymentStatus: mapOneClickStatus(response.status),
    updatedAt: response.updatedAt,
    ...(response.swapDetails.amountIn
      ? { amountInAtomic: response.swapDetails.amountIn }
      : {}),
    ...(response.swapDetails.amountOut
      ? { amountOutAtomic: response.swapDetails.amountOut }
      : {}),
    ...(response.swapDetails.refundedAmount
      ? { refundedAmountAtomic: response.swapDetails.refundedAmount }
      : {}),
    originChainTransactionHashes: response.swapDetails.originChainTxHashes.map(
      (item) => item.hash,
    ),
    destinationChainTransactionHashes:
      response.swapDetails.destinationChainTxHashes.map((item) => item.hash),
    signatureVerified,
  };
}

export function mapOneClickStatus(
  status: OneClickStatus,
): IntentsStatus['paymentStatus'] {
  return {
    PENDING_DEPOSIT: 'AWAITING_DEPOSIT',
    KNOWN_DEPOSIT_TX: 'DEPOSIT_OBSERVED',
    PROCESSING: 'PROCESSING',
    SUCCESS: 'SETTLED',
    INCOMPLETE_DEPOSIT: 'UNDERFUNDED',
    REFUNDED: 'REFUNDED',
    FAILED: 'FAILED',
  }[status] as IntentsStatus['paymentStatus'];
}

function invalidResponse(message: string): ProviderAdapterError {
  return new ProviderAdapterError('PROVIDER_RESPONSE_INVALID', message);
}

function parseProvider<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw invalidResponse('1Click response schema is invalid');
  return parsed.data;
}
