import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  type AuthenticatedRequest,
  CsrfGuard,
  OrganizationPermissionGuard,
  RequireOrganizationPermission,
  requestPrincipal,
  SessionGuard,
} from '../auth/auth.guards.js';
import { InvoiceService } from './invoice.service.js';
import { InvoiceError } from './invoice.types.js';
import {
  createdInvoiceSchema,
  invoiceViewSchema,
  publicInvoiceViewSchema,
} from './invoice.openapi.js';
import {
  SETTLEMENT_OPERATIONS,
  type SettlementOperations,
} from '../settlement/settlement.store.js';
import {
  publicSettlementAttemptSchema,
  publicSettlementQuoteSchema,
  settlementAssetsSchema,
} from '../settlement/settlement.openapi.js';
import {
  mockScenarios,
  SettlementError,
  type SettlementAttempt,
  type SettlementQuote,
} from '../settlement/settlement.types.js';

const atomicAmount = z
  .string()
  .max(78)
  .regex(/^[1-9][0-9]*$/);
const customerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict();
const lineItemSchema = z
  .object({
    description: z.string().trim().min(1).max(200),
    amountAtomic: atomicAmount,
  })
  .strict();
const metadataSchema = z.record(z.string().min(1).max(64), z.string().max(256));
const invoiceFields = {
  invoiceNumber: z.string().trim().min(1).max(64),
  currency: z.string().min(1).max(200),
  payeeDestination: z.string().trim().min(1).max(200),
  customer: customerSchema,
  lineItems: z.array(lineItemSchema).min(1).max(50),
  metadata: metadataSchema,
  dueDate: z.string().datetime({ offset: true }),
};
const createInvoiceSchema = z
  .object({ ...invoiceFields, metadata: metadataSchema.default({}) })
  .strict();
const updateInvoiceSchema = z
  .object(invoiceFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const publicQuoteRequestSchema = z
  .object({
    sourceAssetId: z.string().min(1),
    refundTo: z.string().trim().min(1).max(200),
    slippageBps: z.number().int().min(0).max(1000).default(50),
    scenario: z.enum(mockScenarios).default('success'),
  })
  .strict();
const initiatePaymentSchema = z.object({ quoteId: z.string().uuid() }).strict();

const invoiceRequestSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'invoiceNumber',
    'currency',
    'payeeDestination',
    'customer',
    'lineItems',
    'dueDate',
  ],
  properties: {
    invoiceNumber: { type: 'string', minLength: 1, maxLength: 64 },
    currency: { type: 'string', minLength: 1 },
    payeeDestination: { type: 'string', minLength: 1 },
    customer: {
      type: 'object',
      additionalProperties: false,
      required: ['displayName'],
      properties: {
        displayName: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    },
    lineItems: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'amountAtomic'],
        properties: {
          description: { type: 'string' },
          amountAtomic: {
            type: 'string',
            maxLength: 78,
            pattern: '^[1-9][0-9]*$',
          },
        },
      },
    },
    metadata: { type: 'object', additionalProperties: { type: 'string' } },
    dueDate: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('invoices')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard)
@Controller('v1/orgs/:orgId/invoices')
export class InvoiceController {
  constructor(
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
  ) {}

  @Post()
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:write')
  @ApiOperation({
    summary: 'Create a draft invoice with exact atomic line amounts',
  })
  @ApiParam({ name: 'orgId', type: String })
  @ApiBody({ schema: invoiceRequestSchema })
  @ApiResponse({
    status: 201,
    description: 'Draft and one-time public token',
    schema: createdInvoiceSchema,
  })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.invoices.create(
        organizationId,
        requestPrincipal(request).userId,
        createInvoiceSchema.parse(body),
      ),
    );
  }

  @Get()
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:read')
  @ApiOperation({ summary: 'List organization invoices and payment history' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Organization invoices',
    schema: { type: 'array', items: invoiceViewSchema },
  })
  list(@Param('orgId') organizationId: string) {
    return this.invoices.list(organizationId);
  }

  @Get(':invoiceId')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:read')
  @ApiOperation({ summary: 'Read one organization-scoped invoice' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'invoiceId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, schema: invoiceViewSchema })
  get(
    @Param('orgId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.execute(() => this.invoices.get(organizationId, invoiceId));
  }

  @Patch(':invoiceId')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:write')
  @ApiOperation({
    summary: 'Edit a draft invoice and replace changed line items',
  })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'invoiceId', type: String, format: 'uuid' })
  @ApiBody({ schema: { ...invoiceRequestSchema, required: [] } })
  @ApiResponse({ status: 200, schema: invoiceViewSchema })
  update(
    @Param('orgId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.invoices.update(
        organizationId,
        invoiceId,
        updateInvoiceSchema.parse(body),
      ),
    );
  }

  @Post(':invoiceId/issue')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:write')
  @ApiOperation({ summary: 'Issue an immutable invoice' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'invoiceId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, schema: invoiceViewSchema })
  issue(
    @Param('orgId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.execute(() => this.invoices.issue(organizationId, invoiceId));
  }

  @Post(':invoiceId/expire')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:write')
  @ApiOperation({ summary: 'Expire an issued invoice after its due date' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'invoiceId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, schema: invoiceViewSchema })
  expire(
    @Param('orgId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.execute(() => this.invoices.expire(organizationId, invoiceId));
  }

  @Post(':invoiceId/void')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('invoice:write')
  @ApiOperation({ summary: 'Void a draft or issued invoice' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'invoiceId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, schema: invoiceViewSchema })
  void(
    @Param('orgId') organizationId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.execute(() => this.invoices.void(organizationId, invoiceId));
  }

  private async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException();
      if (error instanceof InvoiceError) {
        if (error.code === 'INVOICE_NOT_FOUND') throw new NotFoundException();
        if (
          error.code === 'INVOICE_NUMBER_CONFLICT' ||
          error.code === 'INVOICE_STATE_CONFLICT' ||
          error.code === 'INVOICE_NOT_DUE'
        ) {
          throw new ConflictException();
        }
        throw new BadRequestException();
      }
      throw error;
    }
  }
}

@ApiTags('public-invoices')
@Controller('v1/public/invoices')
export class PublicInvoiceController {
  constructor(
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
    @Inject(SETTLEMENT_OPERATIONS)
    private readonly settlement: SettlementOperations,
  ) {}

  @Get(':publicToken')
  @ApiOperation({
    summary: 'Read a redacted invoice using its high-entropy token',
  })
  @ApiParam({ name: 'publicToken', type: String })
  @ApiResponse({
    status: 200,
    description: 'Redacted issued invoice',
    schema: publicInvoiceViewSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Token invalid or invoice unavailable',
  })
  async getInvoice(@Param('publicToken') publicToken: string) {
    try {
      return await this.invoices.publicInvoice(publicToken);
    } catch (error) {
      if (error instanceof InvoiceError) throw new NotFoundException();
      throw error;
    }
  }

  @Get(':publicToken/settlement/assets')
  @ApiOperation({ summary: 'List mock assets for a hosted invoice' })
  @ApiParam({ name: 'publicToken', type: String })
  @ApiResponse({ status: 200, schema: settlementAssetsSchema })
  async supportedAssets(@Param('publicToken') publicToken: string) {
    return this.executePublic(publicToken, async () => ({
      mode: 'mock' as const,
      assets: this.settlement.supportedAssets(),
    }));
  }

  @Post(':publicToken/quotes')
  @ApiOperation({
    summary: 'Create a mock quote with invoice-controlled payment fields',
  })
  @ApiParam({ name: 'publicToken', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceAssetId', 'refundTo'],
      properties: {
        sourceAssetId: { type: 'string' },
        refundTo: { type: 'string' },
        slippageBps: { type: 'integer', minimum: 0, maximum: 1000 },
        scenario: { type: 'string', enum: [...mockScenarios] },
      },
    },
  })
  @ApiResponse({ status: 201, schema: publicSettlementQuoteSchema })
  async createQuote(
    @Param('publicToken') publicToken: string,
    @Body() body: unknown,
  ) {
    return this.executePublic(publicToken, async (invoice) => {
      const input = publicQuoteRequestSchema.parse(body);
      const quote = await this.settlement.createQuote(invoice.organizationId, {
        ...input,
        invoiceId: invoice.id,
        destinationAssetId: invoice.currency,
        amountAtomic: invoice.outstandingAmountAtomic,
        recipient: invoice.payeeDestination,
        confidentiality: 'none',
      });
      return publicQuote(quote);
    });
  }

  @Post(':publicToken/payments')
  @ApiOperation({
    summary: 'Authorize an idempotent mock payment for a hosted invoice',
  })
  @ApiParam({ name: 'publicToken', type: String })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['quoteId'],
      properties: { quoteId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiResponse({ status: 201, schema: publicSettlementAttemptSchema })
  async initiate(
    @Param('publicToken') publicToken: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.executePublic(publicToken, async (invoice) => {
      const input = initiatePaymentSchema.parse(body);
      const attempt = await this.settlement.initiate(
        invoice.organizationId,
        idempotencyKey ?? '',
        input.quoteId,
        invoice.id,
      );
      return publicAttempt(attempt, invoice.id);
    });
  }

  @Get(':publicToken/payments/:paymentId')
  @ApiOperation({ summary: 'Read a token-scoped mock payment timeline' })
  @ApiParam({ name: 'publicToken', type: String })
  @ApiParam({ name: 'paymentId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, schema: publicSettlementAttemptSchema })
  async getPayment(
    @Param('publicToken') publicToken: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.executePublic(publicToken, async (invoice) =>
      publicAttempt(
        await this.settlement.getAttempt(invoice.organizationId, paymentId),
        invoice.id,
      ),
    );
  }

  @Post(':publicToken/payments/:paymentId/poll')
  @ApiOperation({ summary: 'Advance a token-scoped mock payment scenario' })
  @ApiParam({ name: 'publicToken', type: String })
  @ApiParam({ name: 'paymentId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, schema: publicSettlementAttemptSchema })
  async poll(
    @Param('publicToken') publicToken: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.executePublic(publicToken, async (invoice) => {
      publicAttempt(
        await this.settlement.getAttempt(invoice.organizationId, paymentId),
        invoice.id,
      );
      return publicAttempt(
        await this.settlement.poll(invoice.organizationId, paymentId),
        invoice.id,
      );
    });
  }

  private async executePublic<T>(
    publicToken: string,
    operation: (
      invoice: Awaited<ReturnType<InvoiceService['publicPaymentContext']>>,
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(
        await this.invoices.publicPaymentContext(publicToken),
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
        });
      }
      if (error instanceof InvoiceError) throw new NotFoundException();
      if (error instanceof SettlementError) throw settlementHttpError(error);
      throw error;
    }
  }
}

function publicQuote(quote: SettlementQuote) {
  const {
    organizationId: _organizationId,
    invoiceId: _invoiceId,
    requestDigest: _requestDigest,
    ...safe
  } = quote;
  return safe;
}

function publicAttempt(attempt: SettlementAttempt, invoiceId: string) {
  if (attempt.invoiceId !== invoiceId) {
    throw new SettlementError('PAYMENT_NOT_FOUND', 'Payment not found');
  }
  const {
    organizationId: _organizationId,
    invoiceId: _invoiceId,
    ...safe
  } = attempt;
  return safe;
}

function settlementHttpError(error: SettlementError): HttpException {
  const body = { code: error.code, message: error.message };
  if (
    error.code === 'QUOTE_NOT_FOUND' ||
    error.code === 'PAYMENT_NOT_FOUND' ||
    error.code === 'INVOICE_NOT_FOUND'
  ) {
    return new NotFoundException(body);
  }
  if (error.code === 'IDEMPOTENCY_CONFLICT') {
    return new ConflictException(body);
  }
  return new BadRequestException(body);
}
