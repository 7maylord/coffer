import { randomUUID } from 'node:crypto';
import { MembershipRole, PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { PrismaOrganizationStore } from '../src/organizations/prisma-organization.store.js';

describe('organization tenancy invariants', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaOrganizationStore(environment);
  const suffix = randomUUID().slice(0, 8);
  let ownerId: string | undefined;
  let inviteeId: string | undefined;
  let organizationId: string | undefined;

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        displayName: 'Organization Owner',
        walletAccounts: {
          create: {
            network: 'testnet',
            accountId: `owner-${suffix}.testnet`,
            lastPublicKey: 'ed25519:11111111111111111111111111111111',
            verifiedAt: new Date(),
          },
        },
      },
    });
    ownerId = owner.id;
    const invitee = await prisma.user.create({
      data: {
        displayName: 'Organization Invitee',
        walletAccounts: {
          create: {
            network: 'testnet',
            accountId: `invitee-${suffix}.testnet`,
            lastPublicKey: 'ed25519:11111111111111111111111111111111',
            verifiedAt: new Date(),
          },
        },
      },
    });
    inviteeId = invitee.id;
  });

  afterAll(async () => {
    if (organizationId) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          "SELECT set_config('coffer.audit_reset', 'on', true)",
        );
        await tx.auditEvent.deleteMany({ where: { organizationId } });
      });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    const userIds = [ownerId, inviteeId].filter(
      (userId): userId is string => userId !== undefined,
    );
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await store.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('creates an owner, accepts only the targeted wallet, and revokes immediately', async () => {
    const organization = await store.createOrganization({
      userId: ownerId!,
      slug: `tenant-${suffix}`,
      name: 'Tenant Integration',
    });
    if (!organization) throw new Error('Expected unique organization fixture');
    organizationId = organization.id;
    expect(Object.keys(organization).sort()).toEqual([
      'id',
      'name',
      'role',
      'slug',
    ]);
    expect(organization.role).toBe(MembershipRole.OWNER);
    await expect(
      store.createOrganization({
        userId: ownerId!,
        slug: `tenant-${suffix}`,
        name: 'Duplicate Tenant',
      }),
    ).resolves.toBeNull();

    const invite = await store.createInvite({
      organizationId,
      invitedByUserId: ownerId!,
      network: 'testnet',
      targetNearAccountId: `invitee-${suffix}.testnet`,
      role: MembershipRole.FINANCE_ADMIN,
      tokenHash: `token-${suffix}`,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    expect(invite).not.toBeNull();

    const baseAcceptance = {
      tokenHash: `token-${suffix}`,
      userId: inviteeId!,
      now: new Date('2026-10-30T00:00:00.000Z'),
    };
    await expect(
      store.acceptInvite({
        ...baseAcceptance,
        wallets: [{ network: 'testnet', accountId: 'attacker.testnet' }],
      }),
    ).resolves.toBeNull();
    await expect(
      store.acceptInvite({
        ...baseAcceptance,
        wallets: [
          { network: 'testnet', accountId: `invitee-${suffix}.testnet` },
        ],
      }),
    ).resolves.toEqual({
      organizationId,
      role: MembershipRole.FINANCE_ADMIN,
    });
    await expect(
      store.acceptInvite({
        ...baseAcceptance,
        wallets: [
          { network: 'testnet', accountId: `invitee-${suffix}.testnet` },
        ],
      }),
    ).resolves.toBeNull();

    await expect(store.listOrganizations(inviteeId!)).resolves.toEqual([
      expect.objectContaining({ id: organizationId, role: 'FINANCE_ADMIN' }),
    ]);
    await expect(store.listMembers(organizationId)).resolves.toHaveLength(2);
    await expect(
      store.revokeMember({
        organizationId,
        actorUserId: ownerId!,
        targetUserId: inviteeId!,
        now: new Date('2026-10-30T00:01:00.000Z'),
      }),
    ).resolves.toBe(true);
    await expect(store.listOrganizations(inviteeId!)).resolves.toEqual([]);
    await expect(store.listMembers(organizationId)).resolves.toHaveLength(1);
  });
});
