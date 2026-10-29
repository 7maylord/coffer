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
  provider: { type: 'string', enum: ['mock'] },
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
  provider: { type: 'string', enum: ['mock'] },
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
