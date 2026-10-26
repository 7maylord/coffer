import { MembershipRole } from '@prisma/client';
import { parseEnvironment } from '../config/env.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { OrganizationService } from './organization.service.js';
import type { OrganizationStore } from './organization.types.js';

describe('OrganizationService', () => {
  const principal: SessionPrincipal = {
    sessionId: 'session_1',
    userId: 'owner_1',
    expiresAt: new Date('2026-10-31T00:00:00.000Z'),
    wallets: [{ network: 'testnet', accountId: 'owner.testnet' }],
    memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
  };
  const createOrganization = vi.fn();
  const listOrganizations = vi.fn();
  const createInvite = vi.fn();
  const acceptInvite = vi.fn();
  const listMembers = vi.fn();
  const revokeMember = vi.fn();
  const store = {
    createOrganization,
    listOrganizations,
    createInvite,
    acceptInvite,
    listMembers,
    revokeMember,
  } as unknown as OrganizationStore;
  const service = new OrganizationService(store, parseEnvironment({}));

  beforeEach(() => vi.clearAllMocks());

  it('creates and lists owner memberships with API role names', async () => {
    createOrganization.mockResolvedValueOnce({
      id: 'org_1',
      slug: 'northstar',
      name: 'Northstar',
      role: MembershipRole.OWNER,
    });
    await expect(
      service.create('owner_1', { slug: 'northstar', name: 'Northstar' }),
    ).resolves.toMatchObject({ role: 'owner' });
    expect(createOrganization).toHaveBeenCalledWith({
      userId: 'owner_1',
      slug: 'northstar',
      name: 'Northstar',
    });

    listOrganizations.mockResolvedValueOnce([
      {
        id: 'org_1',
        slug: 'northstar',
        name: 'Northstar',
        role: MembershipRole.FINANCE_ADMIN,
      },
    ]);
    await expect(service.list('user_1')).resolves.toEqual([
      expect.objectContaining({ role: 'finance_admin' }),
    ]);
  });

  it('returns a conflict when the organization slug already exists', async () => {
    createOrganization.mockResolvedValueOnce(null);
    await expect(
      service.create('owner_1', { slug: 'northstar', name: 'Northstar' }),
    ).rejects.toThrow('Organization slug exists');
  });

  it('returns an account-targeted token once while storing only its hash', async () => {
    createInvite.mockResolvedValueOnce({ id: 'invite_1' });
    const result = await service.invite(
      principal,
      'org_1',
      { targetNearAccountId: 'alice.testnet', role: 'approver' },
      new Date('2026-10-30T00:00:00.000Z'),
    );
    expect(result).toMatchObject({
      inviteId: 'invite_1',
      network: 'testnet',
      targetNearAccountId: 'alice.testnet',
      role: 'approver',
      expiresAt: '2026-10-31T00:00:00.000Z',
    });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        role: MembershipRole.APPROVER,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(createInvite.mock.calls)).not.toContain(result.token);
  });

  it('accepts only through verified session wallets and maps member roles', async () => {
    acceptInvite.mockResolvedValueOnce({
      organizationId: 'org_1',
      role: MembershipRole.VIEWER,
    });
    await expect(service.accept(principal, 't'.repeat(43))).resolves.toEqual({
      organizationId: 'org_1',
      role: 'viewer',
    });
    expect(acceptInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner_1',
        wallets: principal.wallets,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    listMembers.mockResolvedValueOnce([
      {
        userId: 'user_1',
        displayName: 'Alice',
        role: MembershipRole.AUDITOR,
        wallets: [],
      },
    ]);
    await expect(service.members('org_1')).resolves.toEqual([
      expect.objectContaining({ role: 'auditor' }),
    ]);
  });

  it('fails closed for invalid invites and owner self-revocation', async () => {
    createInvite.mockResolvedValueOnce(null);
    await expect(
      service.invite(principal, 'org_missing', {
        targetNearAccountId: 'alice.testnet',
        role: 'viewer',
      }),
    ).rejects.toThrow('Not Found');

    acceptInvite.mockResolvedValueOnce(null);
    await expect(service.accept(principal, 'x'.repeat(43))).rejects.toThrow(
      'Not Found',
    );
    await expect(
      service.revokeMember(principal, 'org_1', principal.userId),
    ).rejects.toThrow('Not Found');

    revokeMember.mockResolvedValueOnce(false);
    await expect(
      service.revokeMember(principal, 'org_1', 'missing'),
    ).rejects.toThrow('Not Found');
    revokeMember.mockResolvedValueOnce(true);
    await expect(
      service.revokeMember(principal, 'org_1', 'user_2'),
    ).resolves.toEqual({ status: 'revoked' });
  });
});
