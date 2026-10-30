import type { SchemaObject } from '@nestjs/swagger';

const nullableDate: SchemaObject = {
  type: 'string',
  format: 'date-time',
  nullable: true,
};

export const invoiceLineItemSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'amountAtomic'],
  properties: {
    description: { type: 'string' },
    amountAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
  },
};

const invoicePaymentAttemptSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'status',
    'amountAtomic',
    'assetId',
    'createdAt',
    'settledAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string' },
    amountAtomic: { type: 'string' },
    assetId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    settledAt: nullableDate,
  },
};

const publicInvoiceProperties: SchemaObject['properties'] = {
  invoiceNumber: { type: 'string' },
  status: {
    type: 'string',
    enum: ['DRAFT', 'ISSUED', 'EXPIRED', 'VOID', 'PAID'],
  },
  paymentState: {
    type: 'string',
    enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID'],
  },
  currency: { type: 'string' },
  totalAmountAtomic: { type: 'string' },
  verifiedReceivedAtomic: { type: 'string' },
  outstandingAmountAtomic: { type: 'string' },
  payeeDestination: { type: 'string' },
  lineItems: { type: 'array', items: invoiceLineItemSchema },
  dueDate: { type: 'string', format: 'date-time' },
};

const publicInvoiceRequired = Object.keys(publicInvoiceProperties);

export const publicInvoiceViewSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: publicInvoiceRequired,
  properties: publicInvoiceProperties,
};

export const invoiceViewSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'organizationId',
    ...publicInvoiceRequired,
    'customer',
    'metadata',
    'revision',
    'version',
    'createdByUserId',
    'createdAt',
    'updatedAt',
    'issuedAt',
    'expiredAt',
    'voidedAt',
    'paidAt',
    'paymentAttempts',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    ...publicInvoiceProperties,
    customer: {
      type: 'object',
      additionalProperties: false,
      required: ['displayName'],
      properties: {
        displayName: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    },
    metadata: { type: 'object', additionalProperties: { type: 'string' } },
    revision: { type: 'integer' },
    version: { type: 'integer' },
    createdByUserId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    issuedAt: nullableDate,
    expiredAt: nullableDate,
    voidedAt: nullableDate,
    paidAt: nullableDate,
    paymentAttempts: {
      type: 'array',
      items: invoicePaymentAttemptSchema,
    },
  },
};

export const createdInvoiceSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['invoice', 'publicToken'],
  properties: {
    invoice: invoiceViewSchema,
    publicToken: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  },
};
