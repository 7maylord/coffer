import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { NearIntents1ClickAdapter } from './near-intents-1click.adapter.js';
import { NearTestnetTransferAdapter } from './near-testnet-transfer.adapter.js';
import {
  ProviderAdapterError,
  type IntentsQuote,
  type IntentsStatus,
  type NearWalletTransaction,
  type OneClickStatus,
} from './provider-adapter.types.js';
import { SettlementError } from './settlement.types.js';

export const INTENTS_SWAP_STORE = Symbol('INTENTS_SWAP_STORE');
const TIDEPOOL_VERIFIER_ACCOUNT_ID = 'verifier.tidepool-sandbox.testnet';

export type IntentsSwapInput = {
  originAssetId: string;
  destinationAssetId: string;
  amountAtomic: string;
  slippageBps: number;
};

export type IntentsSwapRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  provider: 'tidepool';
  environment: 'testnet';
  idempotencyKey: string;
  requestDigest: string;
  correlationId: string;
  originAssetId: string;
  destinationAssetId: string;
  originTokenContract: string;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS';
  amountInAtomic: string;
  amountOutAtomic: string;
  minAmountOutAtomic: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  depositAddress: string;
  deadline: string;
  signatureVerified: boolean;
  depositTransactionHash?: string;
  providerStatus: OneClickStatus;
  internalStatus:
    | 'AWAITING_DEPOSIT'
    | 'DEPOSIT_OBSERVED'
    | 'PROCESSING'
    | 'UNVERIFIED_SUCCESS'
    | 'UNDERFUNDED'
    | 'REFUNDED'
    | 'FAILED';
  providerUpdatedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PreparedIntentsSwap = IntentsSwapRecord & {
  transaction: NearWalletTransaction;
  testOnly: true;
  settlementCredited: false;
};

export interface IntentsSwapStore {
  findByIdempotency(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<IntentsSwapRecord | null>;
  create(record: IntentsSwapRecord): Promise<IntentsSwapRecord>;
  get(organizationId: string, swapId: string): Promise<IntentsSwapRecord>;
  recordDeposit(
    organizationId: string,
    swapId: string,
    transactionHash: string,
  ): Promise<IntentsSwapRecord>;
  recordStatus(
    organizationId: string,
    swapId: string,
    status: IntentsStatus,
  ): Promise<IntentsSwapRecord>;
}

const nearAccount = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

@Injectable()
export class IntentsSwapService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(NearIntents1ClickAdapter)
    private readonly provider: NearIntents1ClickAdapter,
    @Inject(NearTestnetTransferAdapter)
    private readonly transfers: NearTestnetTransferAdapter,
    @Inject(INTENTS_SWAP_STORE) private readonly store: IntentsSwapStore,
  ) {}

  private readonly now = () => new Date();

  async dryQuote(
    input: IntentsSwapInput,
    accountId: string,
  ): Promise<IntentsQuote & { testOnly: true }> {
    this.assertTidepool();
    await this.requireNearRoute(input);
    const quote = await this.provider.quote(
      this.quoteInput(input, nearAccount.parse(accountId), true),
    );
    return { ...quote, testOnly: true };
  }

  async prepare(
    organizationId: string,
    userId: string,
    accountId: string,
    idempotencyKeyValue: string,
    input: IntentsSwapInput,
  ): Promise<PreparedIntentsSwap> {
    this.assertTidepool();
    const signerAccountId = nearAccount.parse(accountId);
    const idempotencyKey = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(idempotencyKeyValue);
    const requestDigest = digest({
      organizationId,
      userId,
      signerAccountId,
      input,
    });
    const existing = await this.store.findByIdempotency(
      organizationId,
      idempotencyKey,
    );
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new SettlementError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different swap',
        );
      }
      return this.prepared(existing);
    }

    const origin = await this.requireNearRoute(input);
    const quote = await this.provider.quote(
      this.quoteInput(input, signerAccountId, false),
    );
    if (!quote.depositAddress || !quote.deadline) {
      throw new ProviderAdapterError(
        'PROVIDER_RESPONSE_INVALID',
        'Tidepool executable quote omitted its deposit instruction',
      );
    }
    const depositAddress = nearAccount.parse(quote.depositAddress);
    const timestamp = this.now().toISOString();
    const record: IntentsSwapRecord = {
      id: randomUUID(),
      organizationId,
      createdByUserId: userId,
      provider: 'tidepool',
      environment: 'testnet',
      idempotencyKey,
      requestDigest,
      correlationId: quote.correlationId,
      originAssetId: input.originAssetId,
      destinationAssetId: input.destinationAssetId,
      originTokenContract: origin.contractAddress!,
      depositType: quote.depositType,
      amountInAtomic: quote.amountInAtomic,
      amountOutAtomic: quote.amountOutAtomic,
      minAmountOutAtomic: quote.minAmountOutAtomic,
      recipient: signerAccountId,
      refundTo: signerAccountId,
      slippageBps: input.slippageBps,
      depositAddress,
      deadline: quote.deadline,
      signatureVerified: quote.signatureVerified,
      providerStatus: 'PENDING_DEPOSIT',
      internalStatus: 'AWAITING_DEPOSIT',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.prepared(await this.store.create(record));
  }

  async get(
    organizationId: string,
    userId: string,
    accountId: string,
    swapId: string,
  ): Promise<PreparedIntentsSwap> {
    const record = await this.store.get(organizationId, swapId);
    this.assertOwner(record, userId, accountId);
    return this.prepared(record);
  }

  async submitDeposit(
    organizationId: string,
    userId: string,
    accountId: string,
    swapId: string,
    transactionHash: string,
  ): Promise<PreparedIntentsSwap> {
    let record = await this.store.get(organizationId, swapId);
    this.assertOwner(record, userId, accountId);
    if (record.depositTransactionHash) {
      if (record.depositTransactionHash !== transactionHash) {
        throw new SettlementError(
          'IDEMPOTENCY_CONFLICT',
          'This swap already has a different deposit transaction',
        );
      }
      return this.poll(organizationId, userId, accountId, swapId);
    }
    if (new Date(record.deadline).getTime() <= this.now().getTime()) {
      throw new SettlementError(
        'QUOTE_EXPIRED',
        'The executable quote expired before the deposit was submitted',
      );
    }
    const origin = await this.requireNearRoute({
      originAssetId: record.originAssetId,
      destinationAssetId: record.destinationAssetId,
      amountAtomic: record.amountInAtomic,
      slippageBps: record.slippageBps,
    });
    if (origin.contractAddress !== record.originTokenContract) {
      throw new ProviderAdapterError(
        'PROVIDER_RESPONSE_INVALID',
        'Tidepool origin token metadata changed after quote creation',
      );
    }
    await this.transfers.verifyAndClaim({
      organizationId,
      referenceId: record.id,
      network: 'testnet',
      assetId: record.originAssetId,
      signerAccountId: record.refundTo,
      receiverAccountId:
        record.depositType === 'INTENTS'
          ? TIDEPOOL_VERIFIER_ACCOUNT_ID
          : record.depositAddress,
      amountAtomic: record.amountInAtomic,
      ...(record.depositType === 'INTENTS'
        ? { transferCallMessage: record.depositAddress }
        : {}),
      transactionHash,
    });
    record = await this.store.recordDeposit(
      organizationId,
      swapId,
      transactionHash,
    );
    const status = await this.provider.submitDepositEvidence({
      transactionHash,
      depositAddress: record.depositAddress,
      nearSenderAccount: record.refundTo,
    });
    this.assertStatus(record, status);
    return this.prepared(
      await this.store.recordStatus(organizationId, swapId, status),
    );
  }

  async poll(
    organizationId: string,
    userId: string,
    accountId: string,
    swapId: string,
  ): Promise<PreparedIntentsSwap> {
    const record = await this.store.get(organizationId, swapId);
    this.assertOwner(record, userId, accountId);
    const status = await this.provider.pollStatus(record.depositAddress);
    this.assertStatus(record, status);
    return this.prepared(
      await this.store.recordStatus(organizationId, swapId, status),
    );
  }

  private quoteInput(input: IntentsSwapInput, accountId: string, dry: boolean) {
    return {
      dry,
      originAsset: input.originAssetId,
      destinationAsset: input.destinationAssetId,
      amountAtomic: input.amountAtomic,
      recipient: accountId,
      refundTo: accountId,
      slippageBps: input.slippageBps,
      deadline: new Date(this.now().getTime() + 10 * 60_000).toISOString(),
      confidentiality: 'none' as const,
    };
  }

  private async requireNearRoute(input: IntentsSwapInput) {
    const discovered = await this.provider.discoverAssets();
    const origin = discovered.find(
      (asset) => asset.assetId === input.originAssetId,
    );
    const destination = discovered.find(
      (asset) => asset.assetId === input.destinationAssetId,
    );
    if (
      !origin ||
      !destination ||
      origin.blockchain !== 'near' ||
      destination.blockchain !== 'near' ||
      !origin.contractAddress
    ) {
      throw new ProviderAdapterError(
        'UNSUPPORTED_PROVIDER_ROUTE',
        'Testnet execution currently supports NEAR-to-NEAR Tidepool tokens only',
      );
    }
    return origin;
  }

  private prepared(record: IntentsSwapRecord): PreparedIntentsSwap {
    const intentsDeposit = record.depositType === 'INTENTS';
    return {
      ...record,
      transaction: {
        network: 'testnet',
        signerAccountId: record.refundTo,
        receiverId: record.originTokenContract,
        actions: [
          {
            type: 'FunctionCall',
            methodName: intentsDeposit ? 'ft_transfer_call' : 'ft_transfer',
            args: intentsDeposit
              ? {
                  receiver_id: TIDEPOOL_VERIFIER_ACCOUNT_ID,
                  amount: record.amountInAtomic,
                  msg: record.depositAddress,
                }
              : {
                  receiver_id: record.depositAddress,
                  amount: record.amountInAtomic,
                },
            gas: intentsDeposit ? '100000000000000' : '30000000000000',
            deposit: '1',
          },
        ],
      },
      testOnly: true,
      settlementCredited: false,
    };
  }

  private assertOwner(
    record: IntentsSwapRecord,
    userId: string,
    accountIdValue: string,
  ): void {
    if (
      record.createdByUserId !== userId ||
      record.refundTo !== nearAccount.parse(accountIdValue)
    ) {
      throw new SettlementError('PAYMENT_NOT_FOUND', 'Swap not found');
    }
  }

  private assertStatus(record: IntentsSwapRecord, status: IntentsStatus): void {
    if (status.correlationId !== record.correlationId) {
      throw new ProviderAdapterError(
        'PROVIDER_RESPONSE_INVALID',
        'Tidepool status belongs to another quote',
      );
    }
  }

  private assertTidepool(): void {
    if (
      this.environment.NEAR_INTENTS_PROVIDER !== 'tidepool' ||
      this.environment.NEAR_NETWORK !== 'testnet'
    ) {
      throw new ProviderAdapterError(
        'PROVIDER_DISABLED',
        'Tidepool testnet swaps are not configured',
      );
    }
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
