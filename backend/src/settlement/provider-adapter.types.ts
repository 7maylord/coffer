export const providerAdapterErrorCodes = [
  'PROVIDER_DISABLED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_RESPONSE_INVALID',
  'PROVIDER_SIGNATURE_INVALID',
  'UNSUPPORTED_PROVIDER_ASSET',
  'UNSUPPORTED_PROVIDER_ROUTE',
  'UNSUPPORTED_PROVIDER_CONFIDENTIALITY',
  'LIVE_OPERATION_DISABLED',
  'TRANSFER_EVIDENCE_MISMATCH',
  'TRANSFER_EVIDENCE_REPLAY',
] as const;

export type ProviderAdapterErrorCode =
  (typeof providerAdapterErrorCodes)[number];

export class ProviderAdapterError extends Error {
  constructor(
    readonly code: ProviderAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
  }
}

export type IntentsAsset = {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  contractAddress?: string;
};

export type IntentsQuoteRequest = {
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  amountAtomic: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
  deadline: string;
  confidentiality: 'none' | 'basic' | 'advanced';
};

export type IntentsQuote = {
  provider: 'near-intents';
  dry: boolean;
  correlationId: string;
  timestamp: string;
  originAsset: string;
  destinationAsset: string;
  amountInAtomic: string;
  minAmountInAtomic: string;
  amountOutAtomic: string;
  minAmountOutAtomic: string;
  timeEstimateSeconds: number;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS';
  refundType: 'ORIGIN_CHAIN' | 'INTENTS';
  depositAddress?: string;
  depositMemo?: string;
  deadline?: string;
  signatureVerified: boolean;
};

export const oneClickStatuses = [
  'PENDING_DEPOSIT',
  'KNOWN_DEPOSIT_TX',
  'PROCESSING',
  'SUCCESS',
  'INCOMPLETE_DEPOSIT',
  'REFUNDED',
  'FAILED',
] as const;

export type OneClickStatus = (typeof oneClickStatuses)[number];

export type IntentsStatus = {
  provider: 'near-intents';
  correlationId: string;
  status: OneClickStatus;
  paymentStatus:
    | 'AWAITING_DEPOSIT'
    | 'DEPOSIT_OBSERVED'
    | 'PROCESSING'
    | 'SETTLED'
    | 'UNDERFUNDED'
    | 'REFUNDED'
    | 'FAILED';
  updatedAt: string;
  amountInAtomic?: string;
  amountOutAtomic?: string;
  refundedAmountAtomic?: string;
  originChainTransactionHashes: string[];
  destinationChainTransactionHashes: string[];
  signatureVerified: boolean;
};

export type NearTransferInstruction = {
  organizationId: string;
  referenceId: string;
  network: 'testnet';
  assetId: string;
  signerAccountId: string;
  receiverAccountId: string;
  amountAtomic: string;
  memo?: string;
  transferCallMessage?: string;
};

export type NearWalletTransaction = {
  network: 'testnet';
  signerAccountId: string;
  receiverId: string;
  actions: ReadonlyArray<
    | { type: 'Transfer'; amountAtomic: string }
    | {
        type: 'FunctionCall';
        methodName: 'ft_transfer' | 'ft_transfer_call';
        args:
          | {
              receiver_id: string;
              amount: string;
              memo?: string;
            }
          | {
              receiver_id: string;
              amount: string;
              msg: string;
            };
        gas: '30000000000000' | '100000000000000';
        deposit: '1';
      }
  >;
};

export type NearTransferEvidence = NearTransferInstruction & {
  provider: 'near-testnet';
  transactionHash: string;
  evidenceDigest: string;
  verifiedAt: string;
};

export interface NearTransferEvidenceStore {
  claim(evidence: NearTransferEvidence): Promise<NearTransferEvidence>;
}
