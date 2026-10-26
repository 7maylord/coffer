import { BadRequestException } from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { OrganizationController } from './organization.controller.js';
import type { OrganizationService } from './organization.service.js';

describe('OrganizationController', () => {
  const create = vi.fn();
  const list = vi.fn();
  const invite = vi.fn();
  const accept = vi.fn();
  const members = vi.fn();
  const revokeMember = vi.fn();
  const organizations = {
    create,
    list,
    invite,
    accept,
    members,
    revokeMember,
  } as unknown as OrganizationService;
  const controller = new OrganizationController(organizations);
  const principal: SessionPrincipal = {
    sessionId: 'session_1',
    userId: 'owner_1',
    expiresAt: new Date(),
    wallets: [{ network: 'testnet', accountId: 'owner.testnet' }],
    memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
  };
  const request = { [AUTH_PRINCIPAL]: principal } as AuthenticatedRequest;

  beforeEach(() => vi.clearAllMocks());

  it('validates organization creation and lists the active principal', async () => {
    create.mockResolvedValueOnce({ id: 'org_1' });
    await expect(
      controller.create(request, { slug: 'northstar', name: ' Northstar ' }),
    ).resolves.toEqual({ id: 'org_1' });
    expect(create).toHaveBeenCalledWith('owner_1', {
      slug: 'northstar',
      name: 'Northstar',
    });

    list.mockResolvedValueOnce([]);
    await expect(controller.list(request)).resolves.toEqual([]);
    expect(list).toHaveBeenCalledWith('owner_1');

    expect(() =>
      controller.create(request, { slug: '../invalid', name: '' }),
    ).toThrow(BadRequestException);
  });

  it('validates targeted invites and acceptance tokens', async () => {
    invite.mockResolvedValueOnce({ inviteId: 'invite_1' });
    await expect(
      controller.invite(request, 'org_1', {
        targetNearAccountId: 'alice.testnet',
        role: 'viewer',
      }),
    ).resolves.toEqual({ inviteId: 'invite_1' });
    expect(invite).toHaveBeenCalledWith(principal, 'org_1', {
      targetNearAccountId: 'alice.testnet',
      role: 'viewer',
    });

    accept.mockResolvedValueOnce({ organizationId: 'org_1' });
    await expect(
      controller.accept(request, { token: 't'.repeat(43) }),
    ).resolves.toEqual({ organizationId: 'org_1' });
    expect(accept).toHaveBeenCalledWith(principal, 't'.repeat(43));

    expect(() =>
      controller.invite(request, 'org_1', {
        targetNearAccountId: 'alice.testnet',
        role: 'owner',
      }),
    ).toThrow(BadRequestException);
    expect(() => controller.accept(request, { token: 'short' })).toThrow(
      BadRequestException,
    );
  });

  it('lists and revokes members through the authorized principal', async () => {
    members.mockResolvedValueOnce([]);
    await expect(controller.members('org_1')).resolves.toEqual([]);
    expect(members).toHaveBeenCalledWith('org_1');

    revokeMember.mockResolvedValueOnce({ status: 'revoked' });
    await expect(
      controller.revokeMember(request, 'org_1', 'user_2'),
    ).resolves.toEqual({ status: 'revoked' });
    expect(revokeMember).toHaveBeenCalledWith(principal, 'org_1', 'user_2');
  });
});
