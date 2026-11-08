import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MembershipRole, PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL ?? '';
const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
if (
  !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
  !localHosts.has(parsedDatabaseUrl.hostname) ||
  !parsedDatabaseUrl.pathname.slice(1) ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error(
    'Full-stack fixtures require a local non-production database',
  );
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const suffix = randomUUID().slice(0, 8);
const sessionToken = randomBytes(32).toString('base64url');
const csrfToken = randomBytes(32).toString('base64url');
const digest = (value) => createHash('sha256').update(value).digest('hex');

try {
  const fixture = await prisma.$transaction(async (transaction) => {
    const organization = await transaction.organization.create({
      data: {
        slug: `fullstack-${suffix}`,
        name: 'Coffer Full-stack Fixture',
      },
    });
    const user = await transaction.user.create({
      data: {
        email: `fullstack-${suffix}@example.test`,
        displayName: 'Full-stack Owner',
      },
    });
    await transaction.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: MembershipRole.OWNER,
      },
    });
    await transaction.walletAccount.create({
      data: {
        userId: user.id,
        network: 'testnet',
        accountId: `fullstack-${suffix}.testnet`,
        lastPublicKey: 'ed25519:11111111111111111111111111111111',
        verifiedAt: new Date(),
      },
    });
    await transaction.authSession.create({
      data: {
        userId: user.id,
        tokenHash: digest(sessionToken),
        csrfTokenHash: digest(csrfToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return { organizationId: organization.id };
  });

  process.stdout.write(JSON.stringify({ ...fixture, sessionToken, csrfToken }));
} finally {
  await prisma.$disconnect();
}
