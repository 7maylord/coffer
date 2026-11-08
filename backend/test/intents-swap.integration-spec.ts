import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import type { IntentsSwapRecord } from '../src/settlement/intents-swap.service.js';
import { PrismaIntentsSwapStore } from '../src/settlement/prisma-intents-swap.store.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';

describe('Tidepool swap persistence', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaIntentsSwapStore(environment);
  const suffix = randomUUID().slice(0, 8);
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;

  beforeAll(async () => {
    const [organization, otherOrganization, user] = await Promise.all([
      prisma.organization.create({
        data: { slug: `intents-a-${suffix}`, name: 'Intents A' },
      }),
      prisma.organization.create({
        data: { slug: `intents-b-${suffix}`, name: 'Intents B' },
      }),
      prisma.user.create({ data: { displayName: 'Intents Fixture' } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.intentsSwap.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
    await Promise.all([store.onModuleDestroy(), prisma.$disconnect()]);
  });

  it('keeps idempotency tenant-scoped and provider success unverified', async () => {
    const timestamp = new Date().toISOString();
    const record: IntentsSwapRecord = {
      id: randomUUID(),
      organizationId,
      createdByUserId: userId,
      provider: 'tidepool',
      environment: 'testnet',
      idempotencyKey: `swap-${suffix}`,
      requestDigest: '1'.repeat(64),
      correlationId: `correlation-${suffix}`,
      originAssetId: 'nep141:usdc.tidepool-sandbox.testnet',
      destinationAssetId: 'nep141:wnear.tidepool-sandbox.testnet',
      originTokenContract: 'usdc.tidepool-sandbox.testnet',
      depositType: 'INTENTS',
      amountInAtomic: '1000000',
      amountOutAtomic: '1000000000000000000000000',
      minAmountOutAtomic: '990000000000000000000000',
      recipient: 'owner.testnet',
      refundTo: 'owner.testnet',
      slippageBps: 100,
      depositAddress: 'deposit.tidepool-sandbox.testnet',
      deadline: new Date(Date.now() + 600_000).toISOString(),
      signatureVerified: false,
      providerStatus: 'PENDING_DEPOSIT',
      internalStatus: 'AWAITING_DEPOSIT',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(store.create(record)).resolves.toMatchObject({
      id: record.id,
    });
    await expect(store.create(record)).resolves.toMatchObject({
      id: record.id,
    });
    await expect(
      store.get(otherOrganizationId, record.id),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });

    const status = {
      provider: 'near-intents' as const,
      correlationId: record.correlationId,
      status: 'SUCCESS' as const,
      paymentStatus: 'SETTLED' as const,
      updatedAt: new Date().toISOString(),
      originChainTransactionHashes: ['1'.repeat(44)],
      destinationChainTransactionHashes: ['2'.repeat(44)],
      signatureVerified: false,
    };
    await expect(
      store.recordStatus(organizationId, record.id, status),
    ).resolves.toMatchObject({
      providerStatus: 'SUCCESS',
      internalStatus: 'UNVERIFIED_SUCCESS',
      signatureVerified: false,
    });
    await store.recordStatus(organizationId, record.id, status);
    await expect(
      prisma.intentsSwapObservation.count({
        where: { intentsSwapId: record.id },
      }),
    ).resolves.toBe(1);
  });
});
