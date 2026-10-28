import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { PolicyService } from './policy.service.js';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const atomic = z.string().regex(/^[1-9][0-9]{0,77}$/);
const materialSchema = z
  .object({
    proposalType: z.string().min(1).max(32),
    chainId: z.string().min(1).max(64),
    assetId: z.string().min(1).max(192),
    amountAtomic: atomic,
    authorizedMaxAtomic: atomic,
    recipientCommitment: hex32,
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    nonceCommitment: hex32,
    idempotencyKeyCommitment: hex32,
    operation: z.string().min(1).max(64),
    environment: z.string().min(1).max(32),
    agentId: z.string().min(1).max(192).optional(),
    vendorId: z.string().min(1).max(192).optional(),
  })
  .strict();
const activateSchema = z.object({ rules: z.unknown() }).strict();
const approvalSchema = z
  .object({
    nearAccountId: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  })
  .strict();
const csrfHeader = { name: 'X-CSRF-Token', required: true } as const;
const materialOpenApiSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'proposalType',
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
  ],
  properties: {
    proposalType: { type: 'string' as const, minLength: 1, maxLength: 32 },
    chainId: { type: 'string' as const, minLength: 1, maxLength: 64 },
    assetId: { type: 'string' as const, minLength: 1, maxLength: 192 },
    amountAtomic: { type: 'string' as const, pattern: '^[1-9][0-9]{0,77}$' },
    authorizedMaxAtomic: {
      type: 'string' as const,
      pattern: '^[1-9][0-9]{0,77}$',
    },
    recipientCommitment: { type: 'string' as const, pattern: '^[0-9a-f]{64}$' },
    expiresAt: { type: 'string' as const, format: 'date-time' },
    nonceCommitment: { type: 'string' as const, pattern: '^[0-9a-f]{64}$' },
    idempotencyKeyCommitment: {
      type: 'string' as const,
      pattern: '^[0-9a-f]{64}$',
    },
    operation: { type: 'string' as const, minLength: 1, maxLength: 64 },
    environment: { type: 'string' as const, minLength: 1, maxLength: 32 },
    agentId: { type: 'string' as const, minLength: 1, maxLength: 192 },
    vendorId: { type: 'string' as const, minLength: 1, maxLength: 192 },
  },
};

@ApiTags('policy')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard, OrganizationPermissionGuard)
@Controller('v1/orgs/:orgId')
export class PolicyController {
  constructor(
    @Inject(PolicyService) private readonly policies: PolicyService,
  ) {}

  @Post('policies')
  @RequireOrganizationPermission('policy:manage')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'orgId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['rules'],
      properties: { rules: { type: 'object' } },
    },
  })
  @ApiOperation({
    summary: 'Activate an immutable organization policy version',
  })
  activate(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.policies.activate(
      requestPrincipal(request).userId,
      organizationId,
      parse(activateSchema, body).rules,
    );
  }

  @Get('policies/active')
  @RequireOrganizationPermission('policy:read')
  @ApiOperation({ summary: 'Read the active deterministic policy version' })
  active(@Param('orgId') organizationId: string) {
    return this.policies.active(organizationId);
  }

  @Post('proposals')
  @RequireOrganizationPermission('proposal:create')
  @ApiHeader(csrfHeader)
  @ApiBody({ schema: materialOpenApiSchema })
  @ApiOperation({ summary: 'Create an immutable financial proposal revision' })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.policies.create(
      requestPrincipal(request).userId,
      organizationId,
      parse(materialSchema, body),
    );
  }

  @Get('proposals/:proposalId')
  @RequireOrganizationPermission('proposal:read')
  @ApiParam({ name: 'proposalId', type: String })
  @ApiOperation({ summary: 'Read a proposal and its immutable approvals' })
  get(
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.policies.get(organizationId, proposalId);
  }

  @Post('proposals/:proposalId/revisions')
  @RequireOrganizationPermission('proposal:create')
  @ApiHeader(csrfHeader)
  @ApiBody({ schema: materialOpenApiSchema })
  @ApiOperation({
    summary: 'Replace material fields with a new proposal revision',
  })
  revise(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.policies.revise(
      requestPrincipal(request).userId,
      organizationId,
      proposalId,
      parse(materialSchema, body),
    );
  }

  @Post('proposals/:proposalId/approvals')
  @RequireOrganizationPermission('proposal:approve')
  @ApiHeader(csrfHeader)
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['nearAccountId'],
      properties: {
        nearAccountId: {
          type: 'string',
          minLength: 2,
          maxLength: 64,
          pattern: '^[a-z0-9]+(?:[._-][a-z0-9]+)*$',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Approve the exact digest using a verified NEAR identity',
  })
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.policies.approve(
      requestPrincipal(request),
      organizationId,
      proposalId,
      parse(approvalSchema, body).nearAccountId,
    );
  }

  @Post('proposals/:proposalId/verify')
  @RequireOrganizationPermission('proposal:verify')
  @ApiHeader(csrfHeader)
  @ApiOperation({
    summary: 'Revalidate policy, quorum, digest, expiry, and contract state',
  })
  verify(
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.policies.verifyForExecution(organizationId, proposalId);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException();
  return parsed.data;
}
