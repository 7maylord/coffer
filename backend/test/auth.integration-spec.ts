import { createHash, randomUUID } from 'node:crypto';
import { MembershipRole, PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth.store.js';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('durable authentication invariants', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaAuthStore(environment);
  const challengeId = randomUUID();
  const accountId = `auth-${challengeId.slice(0, 8)}.testnet`;
  const organizationSlug = `auth-${challengeId.slice(0, 8)}`;
  let userId: string | undefined;
  let organizationId: string | undefined;

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
    await prisma.authChallenge.deleteMany({ where: { id: challengeId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await store.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('T-ID-04 atomically filters revoked membership from an active session', async () => {
    const now = new Date('2026-10-29T13:00:00.000Z');
    const expiresAt = new Date('2026-10-29T13:05:00.000Z');
    const nonceHash = hash('nonce');
    const stateHash = hash('state');
    await store.createChallenge({
      id: challengeId,
      network: 'testnet',
      recipient: 'http://localhost:3000',
      message: 'Sign in to Coffer',
      nonceHash,
      stateHash,
      expiresAt,
      consumedAt: null,
    });

    const consumeInput = {
      challengeId,
      network: 'testnet',
      nonceHash,
      stateHash,
      accountId,
      publicKey: 'ed25519:11111111111111111111111111111111',
      sessionTokenHash: hash('session'),
      csrfTokenHash: hash('csrf'),
      now,
      sessionExpiresAt: new Date('2026-10-29T21:00:00.000Z'),
    };
    const created = await store.consumeChallengeAndCreateSession(consumeInput);
    expect(created).not.toBeNull();
    userId = created?.userId;

    await expect(
      store.consumeChallengeAndCreateSession(consumeInput),
    ).resolves.toBeNull();

    const organization = await prisma.organization.create({
      data: { slug: organizationSlug, name: 'Auth Integration' },
    });
    organizationId = organization.id;
    await prisma.membership.create({
      data: {
        organizationId,
        userId: userId!,
        role: MembershipRole.OWNER,
      },
    });
    await expect(
      store.findActiveSession(
        consumeInput.sessionTokenHash,
        new Date('2026-10-29T13:01:00.000Z'),
      ),
    ).resolves.toMatchObject({
      userId,
      memberships: [{ organizationId, role: 'OWNER' }],
    });

    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId, userId: userId! },
      },
      data: { revokedAt: new Date('2026-10-29T13:02:00.000Z') },
    });
    const afterRevocation = await store.findActiveSession(
      consumeInput.sessionTokenHash,
      new Date('2026-10-29T13:03:00.000Z'),
    );
    expect(afterRevocation?.memberships).toEqual([]);

    await expect(
      store.revokeSession(
        consumeInput.sessionTokenHash,
        hash('wrong-csrf'),
        new Date('2026-10-29T13:03:00.000Z'),
      ),
    ).resolves.toBe(false);
    await expect(
      store.revokeSession(
        consumeInput.sessionTokenHash,
        consumeInput.csrfTokenHash,
        new Date('2026-10-29T13:03:00.000Z'),
      ),
    ).resolves.toBe(true);
    await expect(
      store.findActiveSession(
        consumeInput.sessionTokenHash,
        new Date('2026-10-29T13:04:00.000Z'),
      ),
    ).resolves.toBeNull();
  });
});
