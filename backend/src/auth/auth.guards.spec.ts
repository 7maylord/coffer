import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthService } from './auth.service.js';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
  CsrfGuard,
  OrganizationPermissionGuard,
  SessionGuard,
} from './auth.guards.js';
import type { SessionPrincipal } from './auth.types.js';

const contextFor = (request: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  }) as unknown as ExecutionContext;

describe('authentication and organization guards', () => {
  it('T-ID-04 requires an active membership from the current session', async () => {
    const getSession = vi.fn().mockResolvedValue({ userId: 'user_1' });
    const guard = new SessionGuard({ getSession } as unknown as AuthService);
    const request = {
      headers: { cookie: `coffer_session=${'s'.repeat(43)}` },
    } as AuthenticatedRequest;
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(getSession).toHaveBeenCalledWith('s'.repeat(43));
    expect(request[AUTH_PRINCIPAL]).toEqual({ userId: 'user_1' });

    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('hides non-member organizations and denies missing role permissions', () => {
    const requiredPermission = vi.fn().mockReturnValue('settlement:write');
    const guard = new OrganizationPermissionGuard({
      getAllAndOverride: requiredPermission,
    } as unknown as Reflector);
    const principal: SessionPrincipal = {
      sessionId: 'session_1',
      userId: 'user_1',
      expiresAt: new Date(),
      wallets: [],
      memberships: [],
    };
    const request = {
      headers: {},
      params: { orgId: 'org_1' },
      [AUTH_PRINCIPAL]: principal,
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      NotFoundException,
    );

    principal.memberships.push({ organizationId: 'org_1', role: 'VIEWER' });
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );

    principal.memberships[0]!.role = 'OWNER';
    expect(guard.canActivate(contextFor(request))).toBe(true);
    requiredPermission.mockReturnValueOnce(undefined);
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );
  });

  it('requires double-submit and server-side CSRF proof for mutations', async () => {
    const validateCsrf = vi.fn().mockResolvedValue(undefined);
    const guard = new CsrfGuard({ validateCsrf } as unknown as AuthService);
    await expect(
      guard.canActivate(
        contextFor({ method: 'GET', headers: { cookie: undefined } }),
      ),
    ).resolves.toBe(true);

    const token = 's'.repeat(43);
    const csrf = 'c'.repeat(43);
    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: {
            cookie: `coffer_session=${token}; coffer_csrf=${csrf}`,
            'x-csrf-token': csrf,
          },
        }),
      ),
    ).resolves.toBe(true);
    expect(validateCsrf).toHaveBeenCalledWith(token, csrf);
    await expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: {
            cookie: `coffer_session=${token}; coffer_csrf=${csrf}`,
            'x-csrf-token': 'wrong',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('T-ID-07 separates redacted auditor payroll access from finance plaintext access', () => {
    const requiredPermission = vi.fn().mockReturnValue('payroll:audit');
    const guard = new OrganizationPermissionGuard({
      getAllAndOverride: requiredPermission,
    } as unknown as Reflector);
    const principal: SessionPrincipal = {
      sessionId: 'session_1',
      userId: 'auditor_1',
      expiresAt: new Date(),
      wallets: [],
      memberships: [{ organizationId: 'org_1', role: 'AUDITOR' }],
    };
    const request = {
      headers: {},
      params: { orgId: 'org_1' },
      [AUTH_PRINCIPAL]: principal,
    };
    expect(guard.canActivate(contextFor(request))).toBe(true);
    requiredPermission.mockReturnValue('payroll:read');
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );
    principal.memberships[0]!.role = 'FINANCE_ADMIN';
    expect(guard.canActivate(contextFor(request))).toBe(true);
    requiredPermission.mockReturnValue('payroll:audit');
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );
  });

  it('separates auditor audit reads from finance reconciliation actions', () => {
    const requiredPermission = vi.fn().mockReturnValue('audit:read');
    const guard = new OrganizationPermissionGuard({
      getAllAndOverride: requiredPermission,
    } as unknown as Reflector);
    const principal: SessionPrincipal = {
      sessionId: 'session_1',
      userId: 'auditor_1',
      expiresAt: new Date(),
      wallets: [],
      memberships: [{ organizationId: 'org_1', role: 'AUDITOR' }],
    };
    const request = {
      headers: {},
      params: { orgId: 'org_1' },
      [AUTH_PRINCIPAL]: principal,
    };
    expect(guard.canActivate(contextFor(request))).toBe(true);
    requiredPermission.mockReturnValue('operations:reconcile');
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );
    principal.memberships[0]!.role = 'FINANCE_ADMIN';
    expect(guard.canActivate(contextFor(request))).toBe(true);
    requiredPermission.mockReturnValue('audit:read');
    expect(() => guard.canActivate(contextFor(request))).toThrow(
      ForbiddenException,
    );
  });
});
