import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { JsonRpcProvider } from 'near-api-js';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  AssetRegistry,
  AssetRegistryError,
  type AssetDefinition,
} from '../treasury/asset-registry.js';
import {
  ProviderAdapterError,
  type NearTransferEvidence,
  type NearTransferEvidenceStore,
  type NearTransferInstruction,
  type NearWalletTransaction,
} from './provider-adapter.types.js';

export const NEAR_TRANSFER_EVIDENCE_STORE = Symbol(
  'NEAR_TRANSFER_EVIDENCE_STORE',
);
export const NEAR_RPC_CLIENT = Symbol('NEAR_RPC_CLIENT');

export interface NearRpcClient {
  networkId(): Promise<string>;
  accountCodeHash(accountId: string): Promise<string>;
  callFunction(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  finalTransaction(
    transactionHash: string,
    signerAccountId: string,
  ): Promise<unknown>;
}

class NearApiRpcClient implements NearRpcClient {
  private readonly provider: JsonRpcProvider;

  constructor(url: string) {
    this.provider = new JsonRpcProvider({ url });
  }

  async networkId(): Promise<string> {
    return (await this.provider.viewNodeStatus()).chain_id;
  }

  async accountCodeHash(accountIdValue: string): Promise<string> {
    return (
      await this.provider.viewAccount({
        accountId: accountIdValue,
        blockQuery: { finality: 'final' },
      })
    ).code_hash;
  }

  callFunction(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
  ) {
    return this.provider.callFunction({
      contractId,
      method,
      args,
      blockQuery: { finality: 'final' },
    });
  }

  finalTransaction(transactionHash: string, signerAccountId: string) {
    return this.provider.viewTransactionStatusWithReceipts({
      txHash: transactionHash,
      accountId: signerAccountId,
      waitUntil: 'FINAL',
    });
  }
}

const accountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const atomicAmount = z
  .string()
  .max(78)
  .regex(/^[1-9][0-9]*$/);
const instructionSchema = z
  .object({
    organizationId: z.string().uuid(),
    referenceId: z.string().trim().min(1).max(200),
    network: z.literal('testnet'),
    assetId: z.string().trim().min(1).max(200),
    signerAccountId: accountId,
    receiverAccountId: accountId,
    amountAtomic: atomicAmount,
    memo: z.string().max(256).optional(),
  })
  .strict();
const receiptSchema = z
  .object({
    receipt_id: z.string().min(1),
    predecessor_id: z.string().min(1),
    receiver_id: z.string().min(1),
    receipt: z.unknown(),
  })
  .passthrough();
const outcomeSchema = z
  .object({
    id: z.string().min(1),
    outcome: z
      .object({
        executor_id: z.string().min(1),
        status: z.unknown(),
        logs: z.array(z.string()).max(1000),
      })
      .passthrough(),
  })
  .passthrough();
const finalTransactionSchema = z
  .object({
    final_execution_status: z.literal('FINAL'),
    status: z.unknown(),
    transaction: z
      .object({
        hash: z.string().min(1),
        signer_id: z.string().min(1),
        receiver_id: z.string().min(1),
        actions: z.array(z.unknown()).min(1),
      })
      .passthrough(),
    receipts: z.array(receiptSchema).min(1),
    receipts_outcome: z.array(outcomeSchema).min(1),
  })
  .passthrough();

@Injectable()
export class NearTestnetTransferAdapter {
  private readonly rpc: NearRpcClient;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(AssetRegistry) private readonly assets: AssetRegistry,
    @Inject(NEAR_TRANSFER_EVIDENCE_STORE)
    private readonly evidenceStore: NearTransferEvidenceStore,
    @Optional() @Inject(NEAR_RPC_CLIENT) rpc?: NearRpcClient,
  ) {
    this.rpc = rpc ?? new NearApiRpcClient(environment.NEAR_RPC_URL);
  }

  async walletTransaction(
    input: NearTransferInstruction,
  ): Promise<NearWalletTransaction> {
    this.assertEnabled();
    const instruction = this.instruction(input);
    const asset = await this.testnetAsset(
      instruction.assetId,
      instruction.receiverAccountId,
    );
    if (asset.kind === 'native') {
      return {
        network: 'testnet',
        signerAccountId: instruction.signerAccountId,
        receiverId: instruction.receiverAccountId,
        actions: [{ type: 'Transfer', amountAtomic: instruction.amountAtomic }],
      };
    }
    return {
      network: 'testnet',
      signerAccountId: instruction.signerAccountId,
      receiverId: requireTokenContract(asset),
      actions: [
        {
          type: 'FunctionCall',
          methodName: 'ft_transfer',
          args: {
            receiver_id: instruction.receiverAccountId,
            amount: instruction.amountAtomic,
            ...(instruction.memo ? { memo: instruction.memo } : {}),
          },
          gas: '30000000000000',
          deposit: '1',
        },
      ],
    };
  }

  async verifyAndClaim(
    input: NearTransferInstruction & { transactionHash: string },
  ): Promise<NearTransferEvidence> {
    this.assertEnabled();
    const { transactionHash: submittedHash, ...submittedInstruction } = input;
    const instruction = this.instruction(submittedInstruction);
    const transactionHash = z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/)
      .parse(submittedHash);
    const asset = await this.testnetAsset(
      instruction.assetId,
      instruction.receiverAccountId,
    );

    let network: string;
    let untrustedResult: unknown;
    try {
      [network, untrustedResult] = await Promise.all([
        this.rpc.networkId(),
        this.rpc.finalTransaction(transactionHash, instruction.signerAccountId),
      ]);
    } catch {
      throw new ProviderAdapterError(
        'PROVIDER_UNAVAILABLE',
        'NEAR testnet RPC could not resolve the transaction',
      );
    }
    if (network !== 'testnet') {
      throw mismatch('RPC network does not match the instruction');
    }

    const result = parseFinalTransaction(untrustedResult);
    verifyEnvelope(result, instruction, transactionHash);
    if (asset.kind === 'native') {
      verifyNativeTransfer(result, instruction);
    } else {
      verifyFtTransfer(result, instruction, requireTokenContract(asset));
    }

    const verifiedAt = new Date().toISOString();
    const evidence: NearTransferEvidence = {
      ...instruction,
      provider: 'near-testnet',
      transactionHash,
      evidenceDigest: digest({
        network: instruction.network,
        transactionHash,
        signerAccountId: instruction.signerAccountId,
        receiverAccountId: instruction.receiverAccountId,
        assetId: instruction.assetId,
        amountAtomic: instruction.amountAtomic,
        memo: instruction.memo ?? null,
      }),
      verifiedAt,
    };
    return this.evidenceStore.claim(evidence);
  }

  private assertEnabled(): void {
    if (
      !this.environment.LIVE_TRANSFERS_ENABLED ||
      !this.environment.NEAR_TESTNET_TRANSFERS_ENABLED
    ) {
      throw new ProviderAdapterError(
        'PROVIDER_DISABLED',
        'NEAR testnet transfer support is disabled',
      );
    }
  }

  private instruction(input: NearTransferInstruction): NearTransferInstruction {
    const parsed = instructionSchema.safeParse(input);
    if (!parsed.success) {
      throw mismatch('Transfer instruction is invalid');
    }
    return parsed.data;
  }

  private async testnetAsset(
    assetIdValue: string,
    receiverAccountId: string,
  ): Promise<AssetDefinition> {
    if (assetIdValue.startsWith('near:testnet:nep141:')) {
      const contractId = assetIdValue.slice('near:testnet:nep141:'.length);
      await this.verifyTestToken(contractId, receiverAccountId);
      this.assets.registerVerifiedTestToken(contractId);
    }
    try {
      const asset = this.assets.assertAdapter(assetIdValue, 'near-testnet');
      if (
        asset.environment !== 'testnet' ||
        asset.network !== 'near-testnet' ||
        !asset.testOnly
      ) {
        throw new AssetRegistryError('Invalid testnet asset metadata');
      }
      return asset;
    } catch {
      throw new ProviderAdapterError(
        'UNSUPPORTED_PROVIDER_ASSET',
        'Asset is not registered for direct NEAR testnet transfer',
      );
    }
  }

  private async verifyTestToken(
    contractId: string,
    receiverAccountId: string,
  ): Promise<void> {
    if (
      !this.environment.NEAR_TEST_TOKEN_CONTRACT_ID ||
      !this.environment.NEAR_TEST_TOKEN_CODE_HASH ||
      contractId !== this.environment.NEAR_TEST_TOKEN_CONTRACT_ID
    ) {
      throw new ProviderAdapterError(
        'UNSUPPORTED_PROVIDER_ASSET',
        'ctUSD contract identity and code hash are not configured',
      );
    }
    let codeHash: string;
    let metadata: unknown;
    let config: unknown;
    let storage: unknown;
    try {
      [codeHash, metadata, config, storage] = await Promise.all([
        this.rpc.accountCodeHash(contractId),
        this.rpc.callFunction(contractId, 'ft_metadata', {}),
        this.rpc.callFunction(contractId, 'get_test_token_config', {}),
        this.rpc.callFunction(contractId, 'storage_balance_of', {
          account_id: receiverAccountId,
        }),
      ]);
    } catch {
      throw new ProviderAdapterError(
        'PROVIDER_UNAVAILABLE',
        'ctUSD contract preflight could not be completed',
      );
    }
    const metadataResult = z
      .object({
        spec: z.literal('ft-1.0.0'),
        name: z.literal('Coffer Test Dollar'),
        symbol: z.literal('ctUSD'),
        decimals: z.literal(6),
      })
      .passthrough()
      .safeParse(metadata);
    const configResult = z
      .object({
        issuer: accountId,
        maximum_supply: z.string().regex(/^[1-9][0-9]*$/),
        test_only: z.literal(true),
      })
      .passthrough()
      .safeParse(config);
    const storageResult = z
      .object({ total: z.string().regex(/^[1-9][0-9]*$/) })
      .passthrough()
      .safeParse(storage);
    if (
      codeHash !== this.environment.NEAR_TEST_TOKEN_CODE_HASH ||
      !metadataResult.success ||
      !configResult.success ||
      !storageResult.success
    ) {
      throw mismatch(
        'ctUSD code, metadata, test-only config, or receiver registration is invalid',
      );
    }
  }
}

type FinalTransaction = z.infer<typeof finalTransactionSchema>;

function parseFinalTransaction(value: unknown): FinalTransaction {
  const parsed = finalTransactionSchema.safeParse(value);
  if (!parsed.success || !successfulStatus(parsed.data.status)) {
    throw new ProviderAdapterError(
      'PROVIDER_RESPONSE_INVALID',
      'RPC response is not a successful finalized transaction',
    );
  }
  const seen = new Set<string>();
  for (const outcome of parsed.data.receipts_outcome) {
    if (seen.has(outcome.id) || !successfulStatus(outcome.outcome.status)) {
      throw new ProviderAdapterError(
        'PROVIDER_RESPONSE_INVALID',
        'RPC receipt outcomes are incomplete or unsuccessful',
      );
    }
    seen.add(outcome.id);
  }
  return parsed.data;
}

function verifyEnvelope(
  result: FinalTransaction,
  instruction: NearTransferInstruction,
  transactionHash: string,
): void {
  if (
    result.transaction.hash !== transactionHash ||
    result.transaction.signer_id !== instruction.signerAccountId
  ) {
    throw mismatch('Transaction hash or signer does not match the instruction');
  }
}

function verifyNativeTransfer(
  result: FinalTransaction,
  instruction: NearTransferInstruction,
): void {
  if (
    result.transaction.receiver_id !== instruction.receiverAccountId ||
    !isOnlyNativeTransfer(result.transaction.actions, instruction.amountAtomic)
  ) {
    throw mismatch('Native transfer action does not match the instruction');
  }
  const receipt = result.receipts.find(
    (candidate) =>
      candidate.predecessor_id === instruction.signerAccountId &&
      candidate.receiver_id === instruction.receiverAccountId &&
      isOnlyNativeTransfer(
        receiptActions(candidate.receipt),
        instruction.amountAtomic,
      ),
  );
  requireSuccessfulReceipt(result, receipt, instruction.receiverAccountId);
}

function verifyFtTransfer(
  result: FinalTransaction,
  instruction: NearTransferInstruction,
  tokenContract: string,
): void {
  if (
    result.transaction.receiver_id !== tokenContract ||
    !isOnlyFtTransfer(result.transaction.actions, instruction)
  ) {
    throw mismatch('Fungible-token call does not match the instruction');
  }
  const receipt = result.receipts.find(
    (candidate) =>
      candidate.predecessor_id === instruction.signerAccountId &&
      candidate.receiver_id === tokenContract &&
      isOnlyFtTransfer(receiptActions(candidate.receipt), instruction),
  );
  const outcome = requireSuccessfulReceipt(result, receipt, tokenContract);
  if (!hasExactFtTransferEvent(outcome.outcome.logs, instruction)) {
    throw mismatch(
      'Fungible-token transfer event does not match the instruction',
    );
  }
}

function requireSuccessfulReceipt(
  result: FinalTransaction,
  receipt: FinalTransaction['receipts'][number] | undefined,
  receiverId: string,
): FinalTransaction['receipts_outcome'][number] {
  if (!receipt) throw mismatch('Expected transfer receipt is missing');
  const outcome = result.receipts_outcome.find(
    (candidate) => candidate.id === receipt.receipt_id,
  );
  if (!outcome || outcome.outcome.executor_id !== receiverId) {
    throw mismatch('Transfer receipt outcome does not match the receiver');
  }
  return outcome;
}

function hasExactFtTransferEvent(
  logs: string[],
  instruction: NearTransferInstruction,
): boolean {
  return logs.some((log) => {
    if (!log.startsWith('EVENT_JSON:')) return false;
    let event: unknown;
    try {
      event = JSON.parse(log.slice('EVENT_JSON:'.length));
    } catch {
      return false;
    }
    if (
      !record(event) ||
      event.standard !== 'nep141' ||
      event.version !== '1.0.0' ||
      event.event !== 'ft_transfer' ||
      !Array.isArray(event.data) ||
      event.data.length !== 1 ||
      !record(event.data[0])
    ) {
      return false;
    }
    const transfer = event.data[0];
    return (
      transfer.old_owner_id === instruction.signerAccountId &&
      transfer.new_owner_id === instruction.receiverAccountId &&
      transfer.amount === instruction.amountAtomic &&
      (instruction.memo
        ? transfer.memo === instruction.memo
        : transfer.memo === undefined)
    );
  });
}

function receiptActions(receipt: unknown): unknown[] {
  if (!record(receipt) || !record(receipt.Action)) return [];
  return Array.isArray(receipt.Action.actions) ? receipt.Action.actions : [];
}

function isOnlyNativeTransfer(actions: unknown[], amountAtomic: string) {
  if (actions.length !== 1 || !record(actions[0])) return false;
  const transfer = actions[0].Transfer;
  return record(transfer) && scalar(transfer.deposit) === amountAtomic;
}

function isOnlyFtTransfer(
  actions: unknown[],
  instruction: NearTransferInstruction,
): boolean {
  if (actions.length !== 1 || !record(actions[0])) return false;
  const call = actions[0].FunctionCall;
  if (
    !record(call) ||
    call.method_name !== 'ft_transfer' ||
    scalar(call.gas) !== '30000000000000' ||
    scalar(call.deposit) !== '1' ||
    typeof call.args !== 'string'
  ) {
    return false;
  }
  let args: unknown;
  try {
    args = JSON.parse(Buffer.from(call.args, 'base64').toString('utf8'));
  } catch {
    return false;
  }
  if (!record(args)) return false;
  const allowed = instruction.memo
    ? ['amount', 'memo', 'receiver_id']
    : ['amount', 'receiver_id'];
  if (Object.keys(args).sort().join(',') !== allowed.sort().join(',')) {
    return false;
  }
  return (
    args.receiver_id === instruction.receiverAccountId &&
    args.amount === instruction.amountAtomic &&
    (instruction.memo ? args.memo === instruction.memo : true)
  );
}

function successfulStatus(value: unknown): boolean {
  return (
    record(value) &&
    (typeof value.SuccessValue === 'string' ||
      typeof value.SuccessReceiptId === 'string')
  );
}

function requireTokenContract(asset: AssetDefinition): string {
  if (!asset.tokenContract) {
    throw new ProviderAdapterError(
      'UNSUPPORTED_PROVIDER_ASSET',
      'Test token contract is not configured',
    );
  }
  return asset.tokenContract;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

function mismatch(message: string): ProviderAdapterError {
  return new ProviderAdapterError('TRANSFER_EVIDENCE_MISMATCH', message);
}

function digest(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
