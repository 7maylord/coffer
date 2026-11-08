import { parseEnvironment } from '../config/env.js';
import { NearIntents1ClickAdapter } from './near-intents-1click.adapter.js';
import {
  type IntentsSwapRecord,
  IntentsSwapService,
  type IntentsSwapStore,
} from './intents-swap.service.js';
import { NearTestnetTransferAdapter } from './near-testnet-transfer.adapter.js';
import type {
  IntentsAsset,
  IntentsQuote,
  IntentsQuoteRequest,
  IntentsStatus,
} from './provider-adapter.types.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const accountId = 'owner.testnet';
const swapId = '33333333-3333-4333-8333-333333333333';
const transactionHash = '11111111111111111111111111111111111111111111';
const originAsset = 'nep141:usdc.tidepool-sandbox.testnet';
const destinationAsset = 'nep141:wnear.tidepool-sandbox.testnet';
const depositAddress = 'deposit.tidepool-sandbox.testnet';
const now = new Date('2026-11-07T14:00:00.000Z');

const assets: IntentsAsset[] = [
  {
    assetId: originAsset,
    blockchain: 'near',
    symbol: 'USDC',
    decimals: 6,
    contractAddress: 'usdc.tidepool-sandbox.testnet',
  },
  {
    assetId: destinationAsset,
    blockchain: 'near',
    symbol: 'wNEAR',
    decimals: 24,
    contractAddress: 'wnear.tidepool-sandbox.testnet',
  },
];

class MemoryStore implements IntentsSwapStore {
  records = new Map<string, IntentsSwapRecord>();

  async findByIdempotency(organization: string, key: string) {
    return (
      [...this.records.values()].find(
        (record) =>
          record.organizationId === organization &&
          record.idempotencyKey === key,
      ) ?? null
    );
  }

  async create(record: IntentsSwapRecord) {
    const saved = { ...record, id: swapId };
    this.records.set(saved.id, saved);
    return structuredClone(saved);
  }

  async get(organization: string, id: string) {
    const record = this.records.get(id);
    if (!record || record.organizationId !== organization) throw new Error();
    return structuredClone(record);
  }

  async recordDeposit(organization: string, id: string, hash: string) {
    const record = await this.get(organization, id);
    const next: IntentsSwapRecord = {
      ...record,
      depositTransactionHash: hash,
      internalStatus: 'DEPOSIT_OBSERVED',
      version: record.version + 1,
    };
    this.records.set(id, next);
    return structuredClone(next);
  }

  async recordStatus(organization: string, id: string, status: IntentsStatus) {
    const record = await this.get(organization, id);
    const next: IntentsSwapRecord = {
      ...record,
      providerStatus: status.status,
      internalStatus:
        status.status === 'SUCCESS'
          ? 'UNVERIFIED_SUCCESS'
          : status.status === 'KNOWN_DEPOSIT_TX'
            ? 'DEPOSIT_OBSERVED'
            : 'PROCESSING',
      providerUpdatedAt: status.updatedAt,
      version: record.version + 1,
    };
    this.records.set(id, next);
    return structuredClone(next);
  }
}

function quote(input: IntentsQuoteRequest): IntentsQuote {
  return {
    provider: 'near-intents',
    dry: input.dry,
    correlationId: 'correlation-1',
    timestamp: now.toISOString(),
    originAsset: input.originAsset,
    destinationAsset: input.destinationAsset,
    amountInAtomic: input.amountAtomic,
    minAmountInAtomic: input.amountAtomic,
    amountOutAtomic: '250000000000000000000000',
    minAmountOutAtomic: '247500000000000000000000',
    timeEstimateSeconds: 10,
    depositType: 'INTENTS',
    refundType: 'INTENTS',
    ...(!input.dry
      ? {
          depositAddress,
          deadline: input.deadline,
        }
      : {}),
    signatureVerified: false,
  };
}

function status(value: 'KNOWN_DEPOSIT_TX' | 'SUCCESS'): IntentsStatus {
  return {
    provider: 'near-intents',
    correlationId: 'correlation-1',
    status: value,
    paymentStatus: value === 'SUCCESS' ? 'SETTLED' : 'DEPOSIT_OBSERVED',
    updatedAt: '2026-11-07T14:01:00.000Z',
    originChainTransactionHashes: [transactionHash],
    destinationChainTransactionHashes: [],
    signatureVerified: false,
  };
}

function setup() {
  const store = new MemoryStore();
  const provider = {
    discoverAssets: vi.fn(async () => structuredClone(assets)),
    quote: vi.fn(async (input: IntentsQuoteRequest) => quote(input)),
    submitDepositEvidence: vi.fn(async () => status('KNOWN_DEPOSIT_TX')),
    pollStatus: vi.fn(async () => status('SUCCESS')),
  } as unknown as NearIntents1ClickAdapter;
  const transfers = {
    verifyAndClaim: vi.fn(async () => ({ transactionHash })),
  } as unknown as NearTestnetTransferAdapter;
  const service = new IntentsSwapService(
    parseEnvironment({
      NEAR_INTENTS_PROVIDER: 'tidepool',
      NEAR_INTENTS_API_URL: 'https://www.usetidepool.tech',
      NEAR_INTENTS_DRY_QUOTES_ENABLED: 'true',
      NEAR_INTENTS_WET_QUOTES_ENABLED: 'true',
      LIVE_TRANSFERS_ENABLED: 'true',
      NEAR_TESTNET_TRANSFERS_ENABLED: 'true',
    }),
    provider,
    transfers,
    store,
  );
  return { service, store, provider, transfers };
}

const input = {
  originAssetId: originAsset,
  destinationAssetId: destinationAsset,
  amountAtomic: '1000000',
  slippageBps: 100,
};

describe('IntentsSwapService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => vi.useRealTimers());

  it('creates an exact dry quote for the verified testnet account', async () => {
    const { service, provider } = setup();
    await expect(service.dryQuote(input, accountId)).resolves.toMatchObject({
      dry: true,
      amountInAtomic: '1000000',
      signatureVerified: false,
      testOnly: true,
    });
    expect(vi.mocked(provider.quote)).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: accountId,
        refundTo: accountId,
        confidentiality: 'none',
      }),
    );
  });

  it('prepares one durable wallet instruction for repeated idempotent input', async () => {
    const { service, provider } = setup();
    const first = await service.prepare(
      organizationId,
      userId,
      accountId,
      'swap-1',
      input,
    );
    const replay = await service.prepare(
      organizationId,
      userId,
      accountId,
      'swap-1',
      input,
    );
    expect(replay).toEqual(first);
    expect(vi.mocked(provider.quote)).toHaveBeenCalledOnce();
    expect(first).toMatchObject({
      id: swapId,
      provider: 'tidepool',
      environment: 'testnet',
      depositType: 'INTENTS',
      depositAddress,
      settlementCredited: false,
      transaction: {
        signerAccountId: accountId,
        receiverId: 'usdc.tidepool-sandbox.testnet',
        actions: [
          {
            type: 'FunctionCall',
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: 'verifier.tidepool-sandbox.testnet',
              amount: '1000000',
              msg: depositAddress,
            },
            gas: '100000000000000',
            deposit: '1',
          },
        ],
      },
    });
    await expect(
      service.prepare(organizationId, userId, accountId, 'swap-1', {
        ...input,
        amountAtomic: '2',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('verifies the exact deposit before submission and never credits success', async () => {
    const { service, transfers, provider } = setup();
    const prepared = await service.prepare(
      organizationId,
      userId,
      accountId,
      'swap-2',
      input,
    );
    await expect(
      service.submitDeposit(
        organizationId,
        userId,
        accountId,
        prepared.id,
        transactionHash,
      ),
    ).resolves.toMatchObject({
      depositTransactionHash: transactionHash,
      providerStatus: 'KNOWN_DEPOSIT_TX',
      internalStatus: 'DEPOSIT_OBSERVED',
      settlementCredited: false,
    });
    expect(vi.mocked(transfers.verifyAndClaim)).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverAccountId: 'verifier.tidepool-sandbox.testnet',
        amountAtomic: '1000000',
        transferCallMessage: depositAddress,
        transactionHash,
      }),
    );
    expect(vi.mocked(provider.discoverAssets)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(provider.submitDepositEvidence)).toHaveBeenCalledOnce();

    await expect(
      service.poll(organizationId, userId, accountId, prepared.id),
    ).resolves.toMatchObject({
      providerStatus: 'SUCCESS',
      internalStatus: 'UNVERIFIED_SUCCESS',
      signatureVerified: false,
      settlementCredited: false,
    });
  });

  it('rejects deposit evidence after the provider deadline', async () => {
    const { service, store, transfers } = setup();
    const prepared = await service.prepare(
      organizationId,
      userId,
      accountId,
      'swap-expired',
      input,
    );
    store.records.set(prepared.id, {
      ...prepared,
      deadline: '2026-11-07T13:59:59.000Z',
    });

    await expect(
      service.submitDeposit(
        organizationId,
        userId,
        accountId,
        prepared.id,
        transactionHash,
      ),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    expect(vi.mocked(transfers.verifyAndClaim)).not.toHaveBeenCalled();
  });
});
