import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
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
import { inviteRoles, OrganizationService } from './organization.service.js';

const createOrganizationSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(48)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(100),
  })
  .strict();
const inviteSchema = z
  .object({
    targetNearAccountId: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    role: z.enum(inviteRoles),
  })
  .strict();
const acceptSchema = z
  .object({
    token: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const organizationSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'slug', 'name', 'role'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    role: {
      type: 'string',
      enum: [
        'OWNER',
        'FINANCE_ADMIN',
        'APPROVER',
        'AGENT_OPERATOR',
        'EMPLOYEE',
        'AUDITOR',
        'VIEWER',
      ],
    },
  },
};

const memberSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'displayName', 'role', 'wallets'],
  properties: {
    userId: { type: 'string' },
    displayName: { type: 'string' },
    role: {
      type: 'string',
      enum: [
        'OWNER',
        'FINANCE_ADMIN',
        'APPROVER',
        'AGENT_OPERATOR',
        'EMPLOYEE',
        'AUDITOR',
        'VIEWER',
      ],
    },
    wallets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['network', 'accountId'],
        properties: {
          network: { type: 'string' },
          accountId: { type: 'string' },
        },
      },
    },
  },
};

const inviteResponseSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'inviteId',
    'token',
    'network',
    'targetNearAccountId',
    'role',
    'expiresAt',
  ],
  properties: {
    inviteId: { type: 'string', format: 'uuid' },
    token: { type: 'string', minLength: 43, maxLength: 43 },
    network: { type: 'string' },
    targetNearAccountId: { type: 'string' },
    role: { type: 'string', enum: [...inviteRoles] },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};

const acceptedInviteSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['organizationId', 'role'],
  properties: {
    organizationId: { type: 'string', format: 'uuid' },
    role: {
      type: 'string',
      enum: [
        'FINANCE_ADMIN',
        'APPROVER',
        'AGENT_OPERATOR',
        'EMPLOYEE',
        'AUDITOR',
        'VIEWER',
      ],
    },
  },
};

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException();
  return result.data;
}

@ApiTags('organizations')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard)
@Controller('v1')
export class OrganizationController {
  constructor(
    @Inject(OrganizationService)
    private readonly organizations: OrganizationService,
  ) {}

  @Post('organizations')
  @ApiOperation({ summary: 'Create an organization owned by this session' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['slug', 'name'],
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Organization and owner membership',
    schema: organizationSchema,
  })
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.organizations.create(
      requestPrincipal(request).userId,
      parse(createOrganizationSchema, body),
    );
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List active organization memberships' })
  @ApiResponse({
    status: 200,
    description: 'Active organization memberships',
    schema: { type: 'array', items: organizationSchema },
  })
  list(@Req() request: AuthenticatedRequest) {
    return this.organizations.list(requestPrincipal(request).userId);
  }

  @Post('orgs/:orgId/invites')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('organization:invite')
  @ApiParam({ name: 'orgId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['targetNearAccountId', 'role'],
      additionalProperties: false,
      properties: {
        targetNearAccountId: { type: 'string' },
        role: { type: 'string', enum: [...inviteRoles] },
      },
    },
  })
  @ApiOperation({ summary: 'Create an account-targeted organization invite' })
  @ApiResponse({
    status: 201,
    description: 'Single-use invitation secret; returned only at creation',
    schema: inviteResponseSchema,
  })
  invite(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.organizations.invite(
      requestPrincipal(request),
      organizationId,
      parse(inviteSchema, body),
    );
  }

  @Post('invites/accept')
  @ApiOperation({ summary: 'Accept an invite targeted to a verified wallet' })
  @ApiResponse({
    status: 201,
    description: 'Membership created or restored',
    schema: acceptedInviteSchema,
  })
  accept(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.organizations.accept(
      requestPrincipal(request),
      parse(acceptSchema, body).token,
    );
  }

  @Get('orgs/:orgId/members')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('organization:read')
  @ApiParam({ name: 'orgId', type: String })
  @ApiOperation({ summary: 'List active organization members' })
  @ApiResponse({
    status: 200,
    description: 'Active organization members',
    schema: { type: 'array', items: memberSchema },
  })
  members(@Param('orgId') organizationId: string) {
    return this.organizations.members(organizationId);
  }

  @Delete('orgs/:orgId/members/:userId')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('organization:revoke-member')
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'userId', type: String })
  @ApiOperation({ summary: 'Revoke a non-owner membership immediately' })
  @ApiResponse({
    status: 200,
    description: 'Membership revoked',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['revoked'] } },
    },
  })
  revokeMember(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.organizations.revokeMember(
      requestPrincipal(request),
      organizationId,
      targetUserId,
    );
  }
}
