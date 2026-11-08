import type { SchemaObject } from '@nestjs/swagger';
import { oneClickStatuses } from './provider-adapter.types.js';

export const intentsSwapInputSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'originAssetId',
    'destinationAssetId',
    'amountAtomic',
    'slippageBps',
  ],
  properties: {
    originAssetId: { type: 'string', minLength: 1, maxLength: 500 },
    destinationAssetId: { type: 'string', minLength: 1, maxLength: 500 },
    amountAtomic: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
      maxLength: 78,
    },
    slippageBps: { type: 'integer', minimum: 0, maximum: 1000 },
  },
};

export const intentsQuoteSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'provider',
    'dry',
    'correlationId',
    'timestamp',
    'originAsset',
    'destinationAsset',
    'amountInAtomic',
    'minAmountInAtomic',
    'amountOutAtomic',
    'minAmountOutAtomic',
    'timeEstimateSeconds',
    'depositType',
    'refundType',
    'signatureVerified',
    'testOnly',
  ],
  properties: {
    provider: { type: 'string', enum: ['near-intents'] },
    dry: { type: 'boolean' },
    correlationId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    originAsset: { type: 'string' },
    destinationAsset: { type: 'string' },
    amountInAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
    minAmountInAtomic: { type: 'string', pattern: '^[0-9]+$' },
    amountOutAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
    minAmountOutAtomic: { type: 'string', pattern: '^[0-9]+$' },
    timeEstimateSeconds: { type: 'number', minimum: 0 },
    depositType: { type: 'string', enum: ['ORIGIN_CHAIN', 'INTENTS'] },
    refundType: { type: 'string', enum: ['ORIGIN_CHAIN', 'INTENTS'] },
    signatureVerified: { type: 'boolean' },
    testOnly: { type: 'boolean', enum: [true] },
  },
};

const transactionSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['network', 'signerAccountId', 'receiverId', 'actions'],
  properties: {
    network: { type: 'string', enum: ['testnet'] },
    signerAccountId: { type: 'string' },
    receiverId: { type: 'string' },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        oneOf: [
          functionCallSchema('ft_transfer', '30000000000000', false),
          functionCallSchema('ft_transfer_call', '100000000000000', true),
        ],
      },
    },
  },
};

export const preparedIntentsSwapSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'organizationId',
    'createdByUserId',
    'provider',
    'environment',
    'idempotencyKey',
    'requestDigest',
    'correlationId',
    'originAssetId',
    'destinationAssetId',
    'originTokenContract',
    'depositType',
    'amountInAtomic',
    'amountOutAtomic',
    'minAmountOutAtomic',
    'recipient',
    'refundTo',
    'slippageBps',
    'depositAddress',
    'deadline',
    'signatureVerified',
    'providerStatus',
    'internalStatus',
    'version',
    'createdAt',
    'updatedAt',
    'transaction',
    'testOnly',
    'settlementCredited',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    createdByUserId: { type: 'string', format: 'uuid' },
    provider: { type: 'string', enum: ['tidepool'] },
    environment: { type: 'string', enum: ['testnet'] },
    idempotencyKey: { type: 'string' },
    requestDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    correlationId: { type: 'string' },
    originAssetId: { type: 'string' },
    destinationAssetId: { type: 'string' },
    originTokenContract: { type: 'string' },
    depositType: { type: 'string', enum: ['ORIGIN_CHAIN', 'INTENTS'] },
    amountInAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
    amountOutAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
    minAmountOutAtomic: { type: 'string', pattern: '^[0-9]+$' },
    recipient: { type: 'string' },
    refundTo: { type: 'string' },
    slippageBps: { type: 'integer' },
    depositAddress: { type: 'string' },
    deadline: { type: 'string', format: 'date-time' },
    signatureVerified: { type: 'boolean' },
    depositTransactionHash: { type: 'string' },
    providerStatus: { type: 'string', enum: [...oneClickStatuses] },
    internalStatus: {
      type: 'string',
      enum: [
        'AWAITING_DEPOSIT',
        'DEPOSIT_OBSERVED',
        'PROCESSING',
        'UNVERIFIED_SUCCESS',
        'UNDERFUNDED',
        'REFUNDED',
        'FAILED',
      ],
    },
    providerUpdatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    transaction: transactionSchema,
    testOnly: { type: 'boolean', enum: [true] },
    settlementCredited: { type: 'boolean', enum: [false] },
  },
};

function functionCallSchema(
  methodName: 'ft_transfer' | 'ft_transfer_call',
  gas: '30000000000000' | '100000000000000',
  withMessage: boolean,
): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'methodName', 'args', 'gas', 'deposit'],
    properties: {
      type: { type: 'string', enum: ['FunctionCall'] },
      methodName: { type: 'string', enum: [methodName] },
      args: {
        type: 'object',
        additionalProperties: false,
        required: withMessage
          ? ['receiver_id', 'amount', 'msg']
          : ['receiver_id', 'amount'],
        properties: {
          receiver_id: { type: 'string' },
          amount: { type: 'string', pattern: '^[1-9][0-9]*$' },
          ...(withMessage ? { msg: { type: 'string' } } : {}),
        },
      },
      gas: { type: 'string', enum: [gas] },
      deposit: { type: 'string', enum: ['1'] },
    },
  };
}
