import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { SessionPrincipal } from './auth.types.js';
import { readCookie } from './session-cookie.js';

export const organizationPermissions = [
  'organization:read',
  'organization:invite',
  'organization:revoke-member',
  'settlement:read',
  'settlement:write',
  'invoice:read',
  'invoice:write',
  'policy:read',
  'policy:manage',
  'proposal:read',
  'proposal:create',
  'proposal:approve',
  'proposal:verify',
  'ai:cfo:read',
  'ai:cfo:create',
  'ai:cfo:decide',
  'agent:read',
  'agent:manage',
  'agent:purchase',
  'payroll:import',
  'payroll:read',
  'payroll:approve',
  'payroll:analyze',
  'payroll:audit',
  'audit:read',
  'operations:read',
  'operations:reconcile',
] as const;
export type OrganizationPermission = (typeof organizationPermissions)[number];

const permissionsByRole: Readonly<
  Record<string, ReadonlySet<OrganizationPermission>>
> = {
  OWNER: new Set(organizationPermissions),
  FINANCE_ADMIN: new Set([
    'organization:read',
    'settlement:read',
    'settlement:write',
    'invoice:read',
    'invoice:write',
    'policy:read',
    'proposal:read',
    'proposal:create',
    'proposal:verify',
    'ai:cfo:read',
    'ai:cfo:create',
    'ai:cfo:decide',
    'agent:read',
    'agent:purchase',
    'payroll:import',
    'payroll:read',
    'payroll:approve',
    'payroll:analyze',
    'operations:read',
    'operations:reconcile',
  ]),
  APPROVER: new Set([
    'organization:read',
    'settlement:read',
    'invoice:read',
    'policy:read',
    'proposal:read',
    'proposal:approve',
    'proposal:verify',
    'ai:cfo:read',
    'ai:cfo:decide',
    'agent:read',
  ]),
  AGENT_OPERATOR: new Set([
    'organization:read',
    'policy:read',
    'proposal:read',
    'agent:read',
    'agent:purchase',
  ]),
  EMPLOYEE: new Set([]),
  AUDITOR: new Set([
    'organization:read',
    'settlement:read',
    'invoice:read',
    'policy:read',
    'proposal:read',
    'ai:cfo:read',
    'agent:read',
    'payroll:audit',
    'audit:read',
    'operations:read',
  ]),
  VIEWER: new Set([
    'organization:read',
    'settlement:read',
    'invoice:read',
    'policy:read',
    'proposal:read',
    'ai:cfo:read',
    'agent:read',
  ]),
};

const REQUIRED_ORG_PERMISSION = 'coffer:required-org-permission';
export const RequireOrganizationPermission = (
  permission: OrganizationPermission,
) => SetMetadata(REQUIRED_ORG_PERMISSION, permission);

export const AUTH_PRINCIPAL = Symbol('AUTH_PRINCIPAL');
export type AuthenticatedRequest = Request & {
  [AUTH_PRINCIPAL]?: SessionPrincipal;
};

export function requestPrincipal(
  request: AuthenticatedRequest,
): SessionPrincipal {
  if (!request[AUTH_PRINCIPAL]) throw new UnauthorizedException();
  return request[AUTH_PRINCIPAL];
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, 'coffer_session');
    if (!token) throw new UnauthorizedException();
    request[AUTH_PRINCIPAL] = await this.auth.getSession(token);
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const sessionToken = readCookie(request.headers.cookie, 'coffer_session');
    const csrfCookie = readCookie(request.headers.cookie, 'coffer_csrf');
    const csrfHeader = request.headers['x-csrf-token'];
    if (
      !sessionToken ||
      !csrfCookie ||
      typeof csrfHeader !== 'string' ||
      csrfCookie !== csrfHeader
    ) {
      throw new UnauthorizedException();
    }
    await this.auth.validateCsrf(sessionToken, csrfHeader);
    return true;
  }
}

@Injectable()
export class OrganizationPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<OrganizationPermission>(
      REQUIRED_ORG_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) throw new ForbiddenException();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = requestPrincipal(request);
    const organizationId = request.params.orgId;
    const membership = principal.memberships.find(
      (candidate) => candidate.organizationId === organizationId,
    );
    // Hide organization existence from authenticated non-members.
    if (!membership) throw new NotFoundException();
    if (!permissionsByRole[membership.role]?.has(permission)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
