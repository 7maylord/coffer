import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
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
import {
  intentsQuoteSchema,
  intentsSwapInputSchema,
  preparedIntentsSwapSchema,
} from './intents-swap.openapi.js';
import { IntentsSwapService } from './intents-swap.service.js';
import { ProviderAdapterError } from './provider-adapter.types.js';
import { SettlementError } from './settlement.types.js';

const inputSchema = z
  .object({
    originAssetId: z.string().min(1).max(500),
    destinationAssetId: z.string().min(1).max(500),
    amountAtomic: z
      .string()
      .max(78)
      .regex(/^[1-9][0-9]*$/),
    slippageBps: z.number().int().min(0).max(1000),
  })
  .strict();
const evidenceSchema = z
  .object({
    transactionHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/),
  })
  .strict();

@ApiTags('settlement')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard, OrganizationPermissionGuard)
@Controller('v1/orgs/:orgId/settlement/intents')
export class IntentsSwapController {
  constructor(private readonly swaps: IntentsSwapService) {}

  @Post('dry-quote')
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Preview a Tidepool NEAR testnet swap' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiBody({ schema: intentsSwapInputSchema })
  @ApiResponse({ status: 201, schema: intentsQuoteSchema })
  dryQuote(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = requestPrincipal(request);
    return this.execute(() =>
      this.swaps.dryQuote(
        inputSchema.parse(body),
        testnetAccount(principal.wallets),
      ),
    );
  }

  @Post('swaps')
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Prepare an idempotent Tidepool testnet swap' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: intentsSwapInputSchema })
  @ApiResponse({ status: 201, schema: preparedIntentsSwapSchema })
  prepare(
    @Param('orgId') organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const principal = requestPrincipal(request);
    return this.execute(() =>
      this.swaps.prepare(
        organizationId,
        principal.userId,
        testnetAccount(principal.wallets),
        idempotencyKey ?? '',
        inputSchema.parse(body),
      ),
    );
  }

  @Get('swaps/:swapId')
  @RequireOrganizationPermission('settlement:read')
  @ApiOperation({ summary: 'Read a tenant-scoped Tidepool testnet swap' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'swapId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, schema: preparedIntentsSwapSchema })
  get(
    @Param('orgId') organizationId: string,
    @Param('swapId') swapId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const principal = requestPrincipal(request);
    return this.execute(() =>
      this.swaps.get(
        organizationId,
        principal.userId,
        testnetAccount(principal.wallets),
        z.string().uuid().parse(swapId),
      ),
    );
  }

  @Post('swaps/:swapId/deposit-evidence')
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Verify and submit the wallet deposit evidence' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'swapId', type: String, format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['transactionHash'],
      properties: { transactionHash: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 201, schema: preparedIntentsSwapSchema })
  submitDeposit(
    @Param('orgId') organizationId: string,
    @Param('swapId') swapId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const principal = requestPrincipal(request);
    return this.execute(() =>
      this.swaps.submitDeposit(
        organizationId,
        principal.userId,
        testnetAccount(principal.wallets),
        z.string().uuid().parse(swapId),
        evidenceSchema.parse(body).transactionHash,
      ),
    );
  }

  @Post('swaps/:swapId/poll')
  @RequireOrganizationPermission('settlement:write')
  @ApiOperation({ summary: 'Poll and persist Tidepool testnet swap status' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'swapId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, schema: preparedIntentsSwapSchema })
  poll(
    @Param('orgId') organizationId: string,
    @Param('swapId') swapId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const principal = requestPrincipal(request);
    return this.execute(() =>
      this.swaps.poll(
        organizationId,
        principal.userId,
        testnetAccount(principal.wallets),
        z.string().uuid().parse(swapId),
      ),
    );
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
      if (error instanceof SettlementError) {
        const body = { code: error.code, message: error.message };
        if (error.code === 'IDEMPOTENCY_CONFLICT') {
          throw new ConflictException(body);
        }
        if (error.code === 'PAYMENT_NOT_FOUND') {
          throw new NotFoundException(body);
        }
        throw new BadRequestException(body);
      }
      if (error instanceof ProviderAdapterError) {
        const body = { code: error.code, message: error.message };
        if (
          error.code === 'PROVIDER_UNAVAILABLE' ||
          error.code === 'PROVIDER_DISABLED' ||
          error.code === 'LIVE_OPERATION_DISABLED'
        ) {
          throw new ServiceUnavailableException(body);
        }
        if (
          error.code === 'PROVIDER_RESPONSE_INVALID' ||
          error.code === 'PROVIDER_SIGNATURE_INVALID'
        ) {
          throw new BadGatewayException(body);
        }
        throw new BadRequestException(body);
      }
      throw error;
    }
  }
}

function testnetAccount(
  wallets: Array<{ network: string; accountId: string }>,
): string {
  const account = wallets.find((wallet) => wallet.network === 'testnet');
  if (!account) {
    throw new BadRequestException({
      code: 'TESTNET_WALLET_REQUIRED',
      message: 'A verified NEAR testnet wallet is required',
    });
  }
  return account.accountId;
}
