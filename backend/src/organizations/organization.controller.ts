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
  @ApiResponse({ status: 201, description: 'Membership created or restored' })
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
  members(@Param('orgId') organizationId: string) {
    return this.organizations.members(organizationId);
  }

  @Delete('orgs/:orgId/members/:userId')
  @UseGuards(OrganizationPermissionGuard)
  @RequireOrganizationPermission('organization:revoke-member')
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'userId', type: String })
  @ApiOperation({ summary: 'Revoke a non-owner membership immediately' })
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
