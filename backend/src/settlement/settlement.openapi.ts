import type { SchemaObject } from '@nestjs/swagger';
import { mockScenarios, paymentStatuses } from './settlement.types.js';

export const settlementAssetSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'chain', 'decimals'],
  properties: {
    id: { type: 'string' },
    chain: { type: 'string' },
    decimals: { type: 'integer', minimum: 0 },
  },
};

export const settlementAssetsSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'assets'],
  properties: {
    mode: { type: 'string', enum: ['mock'] },
    assets: { type: 'array', items: settlementAssetSchema },
  },
};

const intentsAssetSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['assetId', 'blockchain', 'symbol', 'decimals'],
  properties: {
    assetId: { type: 'string' },
    blockchain: { type: 'string' },
    symbol: { type: 'string' },
    decimals: { type: 'integer', minimum: 0, maximum: 77 },
    contractAddress: { type: 'string' },
  },
};

export const intentsAssetsSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'environment', 'testOnly', 'assets'],
  properties: {
    provider: { type: 'string', enum: ['one-click', 'tidepool'] },
    environment: { type: 'string', enum: ['mainnet', 'testnet'] },
    testOnly: { type: 'boolean' },
    assets: { type: 'array', maxItems: 10_000, items: intentsAssetSchema },
  },
};

const quoteProperties: SchemaObject['properties'] = {
  id: { type: 'string', format: 'uuid' },
  sourceAssetId: { type: 'string' },
  destinationAssetId: { type: 'string' },
  amountAtomic: { type: 'string' },
  recipient: { type: 'string' },
  refundTo: { type: 'string' },
  slippageBps: { type: 'integer' },
  confidentiality: { type: 'string', enum: ['none', 'basic', 'advanced'] },
  scenario: { type: 'string', enum: [...mockScenarios] },
  provider: { type: 'string', enum: ['mock', 'near-testnet'] },
  expectedAmountAtomic: { type: 'string' },
  expiresAt: { type: 'string', format: 'date-time' },
};

const publicQuoteRequired = Object.keys(quoteProperties);

export const publicSettlementQuoteSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: publicQuoteRequired,
  properties: quoteProperties,
};

export const settlementQuoteSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [...publicQuoteRequired, 'organizationId', 'requestDigest'],
  properties: {
    ...quoteProperties,
    organizationId: { type: 'string', format: 'uuid' },
    invoiceId: { type: 'string', format: 'uuid' },
    requestDigest: { type: 'string' },
  },
};

const historySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'observedAt', 'eventId'],
  properties: {
    status: { type: 'string', enum: [...paymentStatuses] },
    observedAt: { type: 'string', format: 'date-time' },
    eventId: { type: 'string' },
  },
};

const attemptProperties: SchemaObject['properties'] = {
  id: { type: 'string', format: 'uuid' },
  quoteId: { type: 'string', format: 'uuid' },
  provider: { type: 'string', enum: ['mock', 'near-testnet'] },
  scenario: { type: 'string', enum: [...mockScenarios] },
  status: { type: 'string', enum: [...paymentStatuses] },
  version: { type: 'integer' },
  settlementPostingCount: { type: 'integer' },
  refundPostingCount: { type: 'integer' },
  pollCount: { type: 'integer' },
  history: { type: 'array', items: historySchema },
};

const publicAttemptRequired = Object.keys(attemptProperties);

export const publicSettlementAttemptSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: publicAttemptRequired,
  properties: attemptProperties,
};

export const publicNearPaymentSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['payment', 'transaction'],
  properties: {
    payment: publicSettlementAttemptSchema,
    transaction: {
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
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'amountAtomic'],
                properties: {
                  type: { type: 'string', enum: ['Transfer'] },
                  amountAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'methodName', 'args', 'gas', 'deposit'],
                properties: {
                  type: { type: 'string', enum: ['FunctionCall'] },
                  methodName: { type: 'string', enum: ['ft_transfer'] },
                  args: {
                    type: 'object',
                    required: ['receiver_id', 'amount'],
                    properties: {
                      receiver_id: { type: 'string' },
                      amount: { type: 'string', pattern: '^[1-9][0-9]*$' },
                      memo: { type: 'string' },
                    },
                  },
                  gas: { type: 'string', enum: ['30000000000000'] },
                  deposit: { type: 'string', enum: ['1'] },
                },
              },
            ],
          },
        },
      },
    },
  },
};

export const settlementAttemptSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [...publicAttemptRequired, 'organizationId'],
  properties: {
    ...attemptProperties,
    organizationId: { type: 'string', format: 'uuid' },
    invoiceId: { type: 'string', format: 'uuid' },
  },
};
