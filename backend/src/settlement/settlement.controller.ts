import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  Param,
  Post,
  Body,
  UseGuards,
  Inject,
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
  mockScenarios,
  SettlementError,
  type SettlementErrorCode,
} from './settlement.types.js';
import {
  CsrfGuard,
  OrganizationPermissionGuard,
  RequireOrganizationPermission,
  SessionGuard,
} from '../auth/auth.guards.js';
import {
  SETTLEMENT_OPERATIONS,
  type SettlementOperations,
} from './settlement.store.js';
import {
  intentsAssetsSchema,
  settlementAssetsSchema,
  settlementAttemptSchema,
  settlementQuoteSchema,
} from './settlement.openapi.js';
import { NearIntents1ClickAdapter } from './near-intents-1click.adapter.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { ProviderAdapterError } from './provider-adapter.types.js';

const quoteRequestSchema = z
  .object({
    invoiceId: z.string().uuid().optional(),
    sourceAssetId: z.string().min(1),
    destinationAssetId: z.string().min(1),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    recipient: z.string().min(1),
    refundTo: z.string().min(1),
    slippageBps: z.number().int().min(0).max(1000),
    confidentiality: z.enum(['none', 'basic', 'advanced']).default('none'),
    scenario: z.enum(mockScenarios).default('success'),
  })
  .strict();

const initiateSchema = z.object({ quoteId: z.string().min(1) }).strict();

const quoteRequestOpenApiSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceAssetId',
    'destinationAssetId',
    'amountAtomic',
    'recipient',
    'refundTo',
    'slippageBps',
  ],
  properties: {
    invoiceId: { type: 'string', format: 'uuid' },
    sourceAssetId: { type: 'string', minLength: 1 },
    destinationAssetId: { type: 'string', minLength: 1 },
    amountAtomic: { type: 'string', pattern: '^[1-9][0-9]*$' },
    recipient: { type: 'string', minLength: 1 },
    refundTo: { type: 'string', minLength: 1 },
    slippageBps: { type: 'integer', minimum: 0, maximum: 1000 },
    confidentiality: {
      type: 'string',
      enum: ['none', 'basic', 'advanced'],
      default: 'none',
    },
    scenario: {
      type: 'string',
      enum: [...mockScenarios],
      default: 'success',
    },
  },
};

@ApiTags('settlement')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard)
@Controller('v1')
export class SettlementController {
  constructor(
    @Inject(SETTLEMENT_OPERATIONS)
    private readonly settlement: SettlementOperations,
    @Inject(NearIntents1ClickAdapter)
    private readonly nearIntents: NearIntents1ClickAdapter,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  @Get('settlement/assets')
  @ApiOperation({
    summary: 'List fictional assets supported by the mock adapter',
  })
  @ApiResponse({
    status: 200,
    description: 'Mock-only asset registry',
    schema: settlementAssetsSchema,
  })
  supportedAssets() {
    return { mode: 'mock', assets: this.settlement.supportedAssets() };
  }

  @Get('settlement/intents/assets')
  @ApiOperation({ summary: 'Discover current NEAR Intents provider assets' })
  @ApiResponse({
    status: 200,
    description: 'Validated provider asset identities',
    schema: intentsAssetsSchema,
  })
  @ApiResponse({ status: 503, description: 'Provider discovery unavailable' })
  async intentsAssets() {
    return this.execute(async () => {
      const testOnly = this.environment.NEAR_INTENTS_PROVIDER === 'tidepool';
      return {
        provider: this.environment.NEAR_INTENTS_PROVIDER,
        environment: testOnly ? ('testnet' as const) : ('mainnet' as const),
        testOnly,
        assets: await this.nearIntents.discoverAssets(),
      };
    });
  }

  @Post('orgs/:orgId/payments/quotes')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Create a deterministic mock settlement quote' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiBody({ schema: quoteRequestOpenApiSchema })
  @ApiResponse({
    status: 201,
    description: 'Quote created',
    schema: settlementQuoteSchema,
  })
  @ApiResponse({ status: 400, description: 'Safe validation or route error' })
  createQuote(@Param('orgId') organizationId: string, @Body() body: unknown) {
    return this.execute(() =>
      this.settlement.createQuote(
        organizationId,
        quoteRequestSchema.parse(body),
      ),
    );
  }

  @Post('orgs/:orgId/payments')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Initiate an idempotent mock settlement attempt' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['quoteId'],
      properties: { quoteId: { type: 'string', minLength: 1 } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Payment attempt created or replayed',
    schema: settlementAttemptSchema,
  })
  @ApiResponse({ status: 400, description: 'Safe request error' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  initiate(
    @Param('orgId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.execute(() => {
      const input = initiateSchema.parse(body);
      return this.settlement.initiate(
        organizationId,
        idempotencyKey ?? '',
        input.quoteId,
      );
    });
  }

  @Get('orgs/:orgId/payments/:paymentId')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('settlement:read')
  @ApiOperation({ summary: 'Read an organization-scoped payment attempt' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'paymentId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Payment attempt',
    schema: settlementAttemptSchema,
  })
  @ApiResponse({ status: 404, description: 'Payment attempt not found' })
  getAttempt(
    @Param('orgId') organizationId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.execute(() =>
      this.settlement.getAttempt(organizationId, paymentId),
    );
  }

  @Post('orgs/:orgId/payments/:paymentId/poll')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Advance the deterministic mock scenario' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'paymentId', type: String })
  @ApiResponse({
    status: 201,
    description: 'Updated payment attempt',
    schema: settlementAttemptSchema,
  })
  @ApiResponse({ status: 404, description: 'Payment attempt not found' })
  poll(
    @Param('orgId') organizationId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.execute(() => this.settlement.poll(organizationId, paymentId));
  }

  private async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
          details: error.issues,
        });
      }
      if (error instanceof SettlementError) throw this.toHttpError(error);
      if (error instanceof ProviderAdapterError) {
        throw new ServiceUnavailableException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private toHttpError(error: SettlementError): HttpException {
    const body = { code: error.code, message: error.message };
    const notFound: SettlementErrorCode[] = [
      'QUOTE_NOT_FOUND',
      'PAYMENT_NOT_FOUND',
      'INVOICE_NOT_FOUND',
    ];
    if (notFound.includes(error.code)) return new NotFoundException(body);
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      return new ConflictException(body);
    }
    return new BadRequestException(body);
  }
}
