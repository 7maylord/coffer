import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
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
import { TreasuryWorkflowService } from './treasury-workflow.service.js';

const atomic = z.string().regex(/^[1-9][0-9]{0,77}$/);
const splitInput = z
  .object({
    sourceAccountId: z.string().uuid(),
    amountAtomic: atomic,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const policyInput = z
  .object({
    perTransactionCapAtomic: atomic,
    rollingWindowCapAtomic: atomic,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const approvalInput = z
  .object({
    nearAccountId: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  })
  .strict();
const csrfHeader = { name: 'X-CSRF-Token', required: true } as const;
const idempotencyHeader = { name: 'Idempotency-Key', required: true } as const;
const atomicProperty = {
  type: 'string' as const,
  pattern: '^[1-9][0-9]{0,77}$',
};
const splitBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['sourceAccountId', 'amountAtomic', 'expiresAt'],
  properties: {
    sourceAccountId: { type: 'string' as const, format: 'uuid' },
    amountAtomic: atomicProperty,
    expiresAt: { type: 'string' as const, format: 'date-time' },
  },
};
const allocationSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['recipientId', 'basisPoints', 'amountAtomic'],
  properties: {
    recipientId: { type: 'string' },
    basisPoints: { type: 'integer' },
    amountAtomic: { type: 'string' },
  },
};
const splitPreviewSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'amountAtomic',
    'allocations',
    'remainderRecipientId',
    'recipientCommitment',
  ],
  properties: {
    amountAtomic: { type: 'string' },
    allocations: { type: 'array', items: allocationSchema },
    remainderRecipientId: { type: 'string' },
    recipientCommitment: { type: 'string' },
  },
};
const approvalSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'approverUserId',
    'approverNearAccountId',
    'approvedInstructionDigest',
    'createdAt',
  ],
  properties: {
    approverUserId: { type: 'string', format: 'uuid' },
    approverNearAccountId: { type: 'string' },
    approvedInstructionDigest: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
const proposalSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'organizationId',
    'proposalKey',
    'revision',
    'proposalType',
    'status',
    'policyDefinitionId',
    'policyVersion',
    'policyDigest',
    'organizationCommitment',
    'proposalIdCommitment',
    'instructionDigest',
    'chainId',
    'assetId',
    'amountAtomic',
    'authorizedMaxAtomic',
    'recipientCommitment',
    'expiresAt',
    'nonceCommitment',
    'idempotencyKeyCommitment',
    'operation',
    'environment',
    'approvalThreshold',
    'createdByUserId',
    'createdAt',
    'approvals',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    proposalKey: { type: 'string', format: 'uuid' },
    revision: { type: 'integer' },
    proposalType: { type: 'string' },
    status: {
      type: 'string',
      enum: [
        'PENDING',
        'APPROVED',
        'CANCELLED',
        'EXPIRED',
        'SUPERSEDED',
        'STALE_POLICY',
      ],
    },
    policyDefinitionId: { type: 'string', format: 'uuid' },
    policyVersion: { type: 'integer' },
    policyDigest: { type: 'string' },
    organizationCommitment: { type: 'string' },
    proposalIdCommitment: { type: 'string' },
    instructionDigest: { type: 'string' },
    chainId: { type: 'string' },
    assetId: { type: 'string' },
    amountAtomic: { type: 'string' },
    authorizedMaxAtomic: { type: 'string' },
    recipientCommitment: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    nonceCommitment: { type: 'string' },
    idempotencyKeyCommitment: { type: 'string' },
    operation: { type: 'string' },
    environment: { type: 'string' },
    agentId: { type: 'string' },
    vendorId: { type: 'string' },
    approvalThreshold: { type: 'integer' },
    createdByUserId: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    approvals: { type: 'array', items: approvalSchema },
  },
};
const policySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'organizationId', 'version', 'digest', 'rules'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    version: { type: 'integer' },
    digest: { type: 'string' },
    rules: { type: 'object', additionalProperties: true },
  },
};
const accountSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'organizationId',
    'assetId',
    'code',
    'name',
    'accountType',
    'normalSide',
    'postedBalanceAtomic',
    'reservedBalanceAtomic',
    'availableBalanceAtomic',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    assetId: { type: 'string' },
    code: { type: 'string' },
    name: { type: 'string' },
    accountType: {
      type: 'string',
      enum: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'],
    },
    normalSide: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
    postedBalanceAtomic: { type: 'string' },
    reservedBalanceAtomic: { type: 'string' },
    availableBalanceAtomic: { type: 'string' },
    version: { type: 'integer' },
  },
};
const workspaceSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'balanceSource',
    'custodyStatus',
    'asset',
    'accounts',
    'activePolicy',
    'proposals',
    'splitTemplate',
  ],
  properties: {
    balanceSource: { type: 'string', enum: ['ledger-derived internal'] },
    custodyStatus: { type: 'string', enum: ['not on-chain verified'] },
    asset: {
      type: 'object',
      additionalProperties: false,
      required: ['assetId', 'symbol', 'decimals', 'environment'],
      properties: {
        assetId: { type: 'string' },
        symbol: { type: 'string' },
        decimals: { type: 'integer' },
        environment: { type: 'string', enum: ['mock'] },
      },
    },
    accounts: { type: 'array', items: accountSchema },
    activePolicy: { ...policySchema, nullable: true },
    proposals: { type: 'array', items: proposalSchema },
    splitTemplate: {
      type: 'object',
      additionalProperties: false,
      required: ['shares', 'remainderRecipientId', 'recipientCommitment'],
      properties: {
        shares: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['recipientId', 'basisPoints'],
            properties: {
              recipientId: { type: 'string' },
              basisPoints: { type: 'integer' },
            },
          },
        },
        remainderRecipientId: { type: 'string' },
        recipientCommitment: { type: 'string' },
      },
    },
  },
};

@ApiTags('treasury')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard, OrganizationPermissionGuard)
@Controller('v1/orgs/:orgId/treasury')
export class TreasuryWorkflowController {
  constructor(
    @Inject(TreasuryWorkflowService)
    private readonly treasury: TreasuryWorkflowService,
  ) {}

  @Get()
  @RequireOrganizationPermission('proposal:read')
  @ApiOperation({
    summary: 'Read ledger balances, policy, and treasury split revisions',
  })
  @ApiResponse({ status: 200, schema: workspaceSchema })
  workspace(@Param('orgId') organizationId: string) {
    return this.treasury.workspace(organizationId);
  }

  @Post('policy')
  @RequireOrganizationPermission('policy:manage')
  @ApiHeader(csrfHeader)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'perTransactionCapAtomic',
        'rollingWindowCapAtomic',
        'expiresAt',
      ],
      properties: {
        perTransactionCapAtomic: atomicProperty,
        rollingWindowCapAtomic: atomicProperty,
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiOperation({ summary: 'Activate the fixed 2-of-N treasury split policy' })
  @ApiResponse({ status: 201, schema: policySchema })
  activatePolicy(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.treasury.activatePolicy(
      requestPrincipal(request).userId,
      organizationId,
      parse(policyInput, body),
    );
  }

  @Post('split-proposals/preview')
  @RequireOrganizationPermission('proposal:read')
  @ApiHeader(csrfHeader)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amountAtomic'],
      properties: { amountAtomic: atomicProperty },
    },
  })
  @ApiOperation({ summary: 'Preview the exact 50/30/20 integer split' })
  @ApiResponse({ status: 201, schema: splitPreviewSchema })
  preview(@Body() body: unknown) {
    return this.treasury.preview(
      parse(z.object({ amountAtomic: atomic }).strict(), body).amountAtomic,
    );
  }

  @Post('split-proposals')
  @RequireOrganizationPermission('proposal:create')
  @ApiHeader(csrfHeader)
  @ApiHeader(idempotencyHeader)
  @ApiBody({ schema: splitBody })
  @ApiOperation({
    summary: 'Create a server-derived immutable treasury split revision',
  })
  @ApiResponse({ status: 201, schema: proposalSchema })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.treasury.createProposal(
      requestPrincipal(request).userId,
      organizationId,
      parse(splitInput, body),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('split-proposals/:proposalId/revisions')
  @RequireOrganizationPermission('proposal:create')
  @ApiHeader(csrfHeader)
  @ApiHeader(idempotencyHeader)
  @ApiParam({ name: 'proposalId', type: String })
  @ApiBody({ schema: splitBody })
  @ApiOperation({ summary: 'Supersede a split and invalidate its approvals' })
  @ApiResponse({ status: 201, schema: proposalSchema })
  revise(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.treasury.reviseProposal(
      requestPrincipal(request).userId,
      organizationId,
      proposalId,
      parse(splitInput, body),
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Post('split-proposals/:proposalId/approvals')
  @RequireOrganizationPermission('proposal:approve')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'proposalId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['nearAccountId'],
      properties: { nearAccountId: { type: 'string' } },
    },
  })
  @ApiOperation({
    summary: 'Approve with a NEAR wallet verified in this session',
  })
  @ApiResponse({ status: 201, schema: proposalSchema })
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.treasury.approve(
      requestPrincipal(request),
      organizationId,
      proposalId,
      parse(approvalInput, body).nearAccountId,
    );
  }

  @Post('split-proposals/:proposalId/cancel')
  @RequireOrganizationPermission('proposal:create')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'proposalId', type: String })
  @ApiOperation({ summary: 'Reject a pending treasury split revision' })
  @ApiResponse({ status: 201, schema: proposalSchema })
  cancel(
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.treasury.cancel(organizationId, proposalId);
  }

  @Post('split-proposals/:proposalId/reserve')
  @RequireOrganizationPermission('proposal:verify')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'proposalId', type: String })
  @ApiOperation({
    summary: 'Reverify quorum and reserve funds without transferring',
  })
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['verification', 'reservation', 'created', 'split'],
      properties: {
        verification: { type: 'object', additionalProperties: true },
        reservation: { type: 'object', additionalProperties: true },
        created: { type: 'boolean' },
        split: splitPreviewSchema,
      },
    },
  })
  reserve(
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.treasury.reserve(organizationId, proposalId);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException();
  return result.data;
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new BadRequestException('Valid Idempotency-Key required');
  }
  return value;
}
