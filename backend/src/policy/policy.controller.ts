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
  ApiCreatedResponse,
  ApiOkResponse,
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
import { PolicyFactoryService } from './policy-factory.service.js';

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
const sponsoredDeploymentSchema = z
  .object({
    controller: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    approvers: z
      .array(
        z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
      )
      .min(1)
      .max(16),
  })
  .strict();
const csrfHeader = { name: 'X-CSRF-Token', required: true } as const;
const bindingSummaryOpenApiSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'network',
    'contractAccountId',
    'expectedCodeHash',
    'organizationCommitment',
    'required',
  ],
  properties: {
    network: { type: 'string' as const, enum: ['testnet'] },
    contractAccountId: { type: 'string' as const },
    expectedCodeHash: { type: 'string' as const },
    organizationCommitment: {
      type: 'string' as const,
      pattern: '^[0-9a-f]{64}$',
    },
    required: { type: 'boolean' as const, enum: [true] },
  },
};
const deploymentOpenApiSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'deploymentStatus',
    'binding',
    'factoryAccountId',
    'provisionerAccountId',
    'methodName',
    'organizationCommitment',
    'policyDigest',
    'approvalThreshold',
    'eligibleApprovers',
    'minimumDepositYocto',
    'expectedInstanceAccountId',
  ],
  properties: {
    deploymentStatus: {
      type: 'string' as const,
      enum: ['READY', 'PENDING', 'ACTIVE', 'BOUND'],
    },
    binding: { ...bindingSummaryOpenApiSchema, nullable: true },
    factoryAccountId: { type: 'string' as const },
    provisionerAccountId: { type: 'string' as const },
    methodName: { type: 'string' as const, enum: ['create_policy_instance'] },
    organizationCommitment: { type: 'string' as const },
    policyDigest: { type: 'string' as const },
    approvalThreshold: { type: 'integer' as const, minimum: 2, maximum: 16 },
    eligibleApprovers: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['userId', 'role', 'accountId'],
        properties: {
          userId: { type: 'string' as const },
          role: { type: 'string' as const, enum: ['OWNER', 'APPROVER'] },
          accountId: { type: 'string' as const },
        },
      },
    },
    minimumDepositYocto: { type: 'string' as const, pattern: '^[1-9][0-9]*$' },
    expectedInstanceAccountId: { type: 'string' as const },
  },
};
const deploymentPreviewOpenApiSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'network',
    'signerId',
    'receiverId',
    'methodName',
    'args',
    'gas',
    'depositYocto',
    'expectedInstanceAccountId',
  ],
  properties: {
    network: { type: 'string' as const, enum: ['testnet'] },
    signerId: { type: 'string' as const },
    receiverId: { type: 'string' as const },
    methodName: { type: 'string' as const, enum: ['create_policy_instance'] },
    args: {
      type: 'object' as const,
      additionalProperties: false,
      required: [
        'organization_commitment',
        'controller',
        'policy_digest',
        'approvers',
        'approval_threshold',
      ],
      properties: {
        organization_commitment: { type: 'string' as const },
        controller: { type: 'string' as const },
        policy_digest: { type: 'string' as const },
        approvers: {
          type: 'array' as const,
          minItems: 2,
          maxItems: 16,
          items: { type: 'string' as const },
        },
        approval_threshold: {
          type: 'integer' as const,
          minimum: 2,
          maximum: 16,
        },
      },
    },
    gas: { type: 'string' as const, pattern: '^[1-9][0-9]*$' },
    depositYocto: { type: 'string' as const, pattern: '^[1-9][0-9]*$' },
    expectedInstanceAccountId: { type: 'string' as const },
  },
};
const bindingOpenApiSchema = {
  ...bindingSummaryOpenApiSchema,
  required: [
    ...bindingSummaryOpenApiSchema.required,
    'id',
    'organizationId',
    'verifiedAt',
    'version',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    ...bindingSummaryOpenApiSchema.properties,
    id: { type: 'string' as const, format: 'uuid' },
    organizationId: { type: 'string' as const, format: 'uuid' },
    verifiedAt: {
      type: 'string' as const,
      format: 'date-time',
      nullable: true,
    },
    version: { type: 'integer' as const, minimum: 1 },
    createdAt: { type: 'string' as const, format: 'date-time' },
    updatedAt: { type: 'string' as const, format: 'date-time' },
  },
};
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
    @Inject(PolicyFactoryService)
    private readonly factory: PolicyFactoryService,
  ) {}

  @Get('policy-contract/deployment')
  @RequireOrganizationPermission('policy:manage')
  @ApiParam({ name: 'orgId', type: String })
  @ApiOperation({
    summary: 'Prepare a provisioner-signed testnet policy instance call',
  })
  @ApiOkResponse({ schema: deploymentOpenApiSchema })
  deployment(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
  ) {
    return this.factory.prepare(requestPrincipal(request), organizationId);
  }

  @Post('policy-contract/deployment-preview')
  @RequireOrganizationPermission('policy:manage')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'orgId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['controller', 'approvers'],
      properties: {
        controller: { type: 'string' },
        approvers: { type: 'array', items: { type: 'string' }, maxItems: 16 },
      },
    },
  })
  @ApiOperation({ summary: 'Prepare an unsigned, sponsor-funded factory call' })
  @ApiCreatedResponse({ schema: deploymentPreviewOpenApiSchema })
  deploymentPreview(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.factory.previewSponsoredCall(
      requestPrincipal(request),
      organizationId,
      parse(sponsoredDeploymentSchema, body),
    );
  }

  @Post('policy-contract/binding')
  @RequireOrganizationPermission('policy:manage')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'orgId', type: String })
  @ApiOperation({
    summary: 'Bind an active, final and verified factory policy instance',
  })
  @ApiCreatedResponse({ schema: bindingOpenApiSchema })
  bindContract(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
  ) {
    return this.factory.bind(requestPrincipal(request), organizationId);
  }

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
