import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
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
import { AutomationService } from './automation.service.js';
import { AutomationError } from './automation.types.js';
import {
  agentSchema as agentResponseSchema,
  agentWorkspaceSchema,
  cfoProposalSchema,
  cfoWorkspaceSchema,
  financialProposalSchema,
  offerSchema,
  policySchema,
  purchaseSchema,
} from './automation.openapi.js';

const atomic = z.string().regex(/^[1-9][0-9]{0,77}$/);
const cfoRequestSchema = z
  .object({
    sourceAccountId: z.string().uuid(),
    assetId: z.string().min(1).max(192),
    maximumAmountAtomic: atomic,
    allowedCategories: z.array(z.string().min(1).max(64)).min(1).max(20),
    supportingRecordIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .strict();
const decisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const agentSchema = z
  .object({
    purpose: z.string().min(1).max(200),
    allowedActions: z
      .array(z.literal('purchase:document-classification'))
      .length(1),
    assetId: z.literal('mock:base:usdc'),
    chainId: z.literal('mock:base'),
    maxAmountAtomic: atomic,
    rollingBudgetAtomic: atomic,
    rollingWindowSeconds: z
      .number()
      .int()
      .min(60)
      .max(31_536_000)
      .default(86_400),
    vendorAllowlist: z.array(z.literal('mock-document-classifier')).length(1),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const offerRequestSchema = z
  .object({
    serviceCode: z.literal('document-classification'),
    documentCount: z.number().int().min(1).max(100),
    classificationProfile: z.enum(['standard', 'financial']),
  })
  .strict();
const purchaseRequestSchema = z.object({ offerId: z.string().uuid() }).strict();
const approvalSchema = z
  .object({ nearAccountId: z.string().trim().min(2).max(64) })
  .strict();
const atomicProperty = {
  type: 'string' as const,
  pattern: '^[1-9][0-9]{0,77}$',
};
const cfoRequestOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceAccountId',
    'assetId',
    'maximumAmountAtomic',
    'allowedCategories',
    'supportingRecordIds',
  ],
  properties: {
    sourceAccountId: { type: 'string', format: 'uuid' },
    assetId: { type: 'string', maxLength: 192 },
    maximumAmountAtomic: atomicProperty,
    allowedCategories: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', maxLength: 64 },
    },
    supportingRecordIds: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: { type: 'string', format: 'uuid' },
    },
  },
};
const decisionOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
    note: { type: 'string', maxLength: 500 },
  },
};
const agentOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'purpose',
    'allowedActions',
    'assetId',
    'chainId',
    'maxAmountAtomic',
    'rollingBudgetAtomic',
    'vendorAllowlist',
    'expiresAt',
  ],
  properties: {
    purpose: { type: 'string', maxLength: 200 },
    allowedActions: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'string',
        enum: ['purchase:document-classification'],
      },
    },
    assetId: { type: 'string', enum: ['mock:base:usdc'] },
    chainId: { type: 'string', enum: ['mock:base'] },
    maxAmountAtomic: atomicProperty,
    rollingBudgetAtomic: atomicProperty,
    rollingWindowSeconds: {
      type: 'integer',
      minimum: 60,
      maximum: 31_536_000,
      default: 86_400,
      description: 'Rolling spend window in seconds',
    },
    vendorAllowlist: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: { type: 'string', enum: ['mock-document-classifier'] },
    },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};
const offerOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceCode', 'documentCount', 'classificationProfile'],
  properties: {
    serviceCode: {
      type: 'string',
      enum: ['document-classification'],
    },
    documentCount: { type: 'integer', minimum: 1, maximum: 100 },
    classificationProfile: {
      type: 'string',
      enum: ['standard', 'financial'],
    },
  },
};
const purchaseOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['offerId'],
  properties: { offerId: { type: 'string', format: 'uuid' } },
};
const csrfHeader = { name: 'X-CSRF-Token', required: true } as const;
@ApiTags('automation')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard, OrganizationPermissionGuard)
@Controller('v1/orgs/:orgId')
export class AutomationController {
  constructor(
    @Inject(AutomationService) private readonly automation: AutomationService,
  ) {}

  @Post('ai/cfo/proposals')
  @RequireOrganizationPermission('ai:cfo:create')
  @ApiHeader(csrfHeader)
  @ApiBody({ schema: cfoRequestOpenApi })
  @ApiOperation({
    summary: 'Create a schema-validated CFO allocation suggestion',
  })
  @ApiResponse({ status: 201, schema: cfoProposalSchema })
  createCfo(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.automation.createCfoProposal(
        organizationId,
        requestPrincipal(request).userId,
        cfoRequestSchema.parse(body),
      ),
    );
  }

  @Get('ai/cfo/proposals/:proposalId')
  @RequireOrganizationPermission('ai:cfo:read')
  @ApiParam({ name: 'proposalId', type: String })
  @ApiOperation({
    summary: 'Read a scoped CFO proposal and inference metadata',
  })
  @ApiResponse({ status: 200, schema: cfoProposalSchema })
  getCfo(
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.execute(() =>
      this.automation.cfoProposal(organizationId, proposalId),
    );
  }

  @Get('ai/cfo/workspace')
  @RequireOrganizationPermission('ai:cfo:read')
  @ApiOperation({
    summary: 'List CFO proposals and truthful provider evidence',
  })
  @ApiResponse({ status: 200, schema: cfoWorkspaceSchema })
  cfoWorkspace(@Param('orgId') organizationId: string) {
    return this.automation.cfoWorkspace(organizationId);
  }

  @Post('ai/cfo/proposals/:proposalId/decision')
  @RequireOrganizationPermission('ai:cfo:decide')
  @ApiHeader(csrfHeader)
  @ApiBody({ schema: decisionOpenApi })
  @ApiOperation({
    summary: 'Approve to reserve ledger funds, or reject without side effects',
  })
  @ApiResponse({ status: 201, schema: cfoProposalSchema })
  decideCfo(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() => {
      const parsed = decisionSchema.parse(body);
      return this.automation.decideCfoProposal(
        organizationId,
        proposalId,
        requestPrincipal(request).userId,
        parsed.decision,
        parsed.note,
      );
    });
  }

  @Post('agents')
  @RequireOrganizationPermission('agent:manage')
  @ApiHeader(csrfHeader)
  @ApiBody({ schema: agentOpenApi })
  @ApiOperation({
    summary: 'Create an expiring least-privilege procurement agent',
  })
  @ApiResponse({ status: 201, schema: agentResponseSchema })
  createAgent(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.automation.createAgent(
        organizationId,
        requestPrincipal(request).userId,
        agentSchema.parse(body),
      ),
    );
  }

  @Get('agents')
  @RequireOrganizationPermission('agent:read')
  @ApiOperation({ summary: 'List tenant-scoped procurement agents' })
  @ApiResponse({
    status: 200,
    schema: { type: 'array', items: agentResponseSchema },
  })
  agents(@Param('orgId') organizationId: string) {
    return this.automation.agents(organizationId);
  }

  @Get('agent-workspace')
  @RequireOrganizationPermission('agent:read')
  @ApiOperation({
    summary: 'List bounded agents, offers, purchases and feature state',
  })
  @ApiResponse({ status: 200, schema: agentWorkspaceSchema })
  agentWorkspace(@Param('orgId') organizationId: string) {
    return this.automation.agentWorkspace(organizationId);
  }

  @Post('agents/:agentId/revoke')
  @RequireOrganizationPermission('agent:manage')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'agentId', type: String })
  @ApiOperation({ summary: 'Immediately revoke a procurement agent' })
  @ApiResponse({ status: 201, schema: agentResponseSchema })
  revokeAgent(
    @Param('orgId') organizationId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.execute(() =>
      this.automation.revokeAgent(organizationId, agentId),
    );
  }

  @Post('agents/:agentId/policy')
  @RequireOrganizationPermission('policy:manage')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'agentId', type: String })
  @ApiOperation({
    summary: 'Merge a bounded agent into the active central policy',
  })
  @ApiResponse({ status: 201, schema: policySchema })
  activateAgentPolicy(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.execute(() =>
      this.automation.activateAgentPolicy(
        organizationId,
        requestPrincipal(request).userId,
        agentId,
      ),
    );
  }

  @Post('agents/:agentId/offers')
  @RequireOrganizationPermission('agent:purchase')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'agentId', type: String })
  @ApiBody({ schema: offerOpenApi })
  @ApiOperation({
    summary: 'Request a bounded offer from the seeded internal mock vendor',
  })
  @ApiResponse({ status: 201, schema: offerSchema })
  requestOffer(
    @Param('orgId') organizationId: string,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.automation.requestOffer(
        organizationId,
        agentId,
        offerRequestSchema.parse(body),
      ),
    );
  }

  @Post('agents/:agentId/purchase-proposals')
  @RequireOrganizationPermission('agent:purchase')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'agentId', type: String })
  @ApiBody({ schema: purchaseOpenApi })
  @ApiOperation({
    summary: 'Bind an offer to an immutable central-policy proposal',
  })
  @ApiResponse({ status: 201, schema: purchaseSchema })
  createPurchase(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.automation.createPurchaseProposal(
        organizationId,
        requestPrincipal(request).userId,
        agentId,
        purchaseRequestSchema.parse(body).offerId,
      ),
    );
  }

  @Get('agent-purchases/:purchaseId')
  @RequireOrganizationPermission('agent:read')
  @ApiParam({ name: 'purchaseId', type: String })
  @ApiOperation({ summary: 'Read a policy-bound agent purchase' })
  @ApiResponse({ status: 200, schema: purchaseSchema })
  getPurchase(
    @Param('orgId') organizationId: string,
    @Param('purchaseId') purchaseId: string,
  ) {
    return this.execute(() =>
      this.automation.purchase(organizationId, purchaseId),
    );
  }

  @Post('agent-purchases/:purchaseId/approvals')
  @RequireOrganizationPermission('proposal:approve')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'purchaseId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['nearAccountId'],
      properties: { nearAccountId: { type: 'string' } },
    },
  })
  @ApiOperation({ summary: 'Approve the exact policy-bound purchase revision' })
  @ApiResponse({ status: 201, schema: financialProposalSchema })
  approvePurchase(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('purchaseId') purchaseId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.automation.approvePurchase(
        requestPrincipal(request),
        organizationId,
        purchaseId,
        approvalSchema.parse(body).nearAccountId,
      ),
    );
  }

  @Post('agent-purchases/:purchaseId/execute')
  @RequireOrganizationPermission('agent:purchase')
  @ApiHeader(csrfHeader)
  @ApiParam({ name: 'purchaseId', type: String })
  @ApiOperation({
    summary: 'Revalidate approval and complete mock vendor fulfillment',
  })
  @ApiResponse({ status: 201, schema: purchaseSchema })
  executePurchase(
    @Param('orgId') organizationId: string,
    @Param('purchaseId') purchaseId: string,
  ) {
    return this.execute(() =>
      this.automation.executePurchase(organizationId, purchaseId),
    );
  }

  private async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException();
      if (error instanceof AutomationError) {
        if (error.code === 'AUTOMATION_NOT_FOUND')
          throw new NotFoundException();
        if (
          error.code === 'AGENT_DISABLED' ||
          error.code === 'AI_PROVIDER_UNAVAILABLE'
        ) {
          throw new ServiceUnavailableException();
        }
        if (
          error.code === 'AGENT_INACTIVE' ||
          error.code === 'VENDOR_NOT_ALLOWED'
        ) {
          throw new ForbiddenException();
        }
        if (
          error.code === 'PURCHASE_DUPLICATE' ||
          error.code === 'OFFER_EXPIRED' ||
          error.code === 'PURCHASE_NOT_EXECUTABLE'
        ) {
          throw new ConflictException();
        }
        throw new BadRequestException();
      }
      throw error;
    }
  }
}
