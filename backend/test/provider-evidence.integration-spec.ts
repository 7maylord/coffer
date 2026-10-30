import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { PrismaNearTransferEvidenceStore } from '../src/settlement/prisma-near-transfer-evidence.store.js';
import type { NearTransferEvidence } from '../src/settlement/provider-adapter.types.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';

describe('provider transfer evidence persistence', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaNearTransferEvidenceStore(environment);
  const suffix = randomUUID().slice(0, 8);
  let organizationIds: [string, string];

  beforeAll(async () => {
    const organizations = await Promise.all([
      prisma.organization.create({
        data: { slug: `provider-a-${suffix}`, name: 'Provider A' },
      }),
      prisma.organization.create({
        data: { slug: `provider-b-${suffix}`, name: 'Provider B' },
      }),
    ]);
    organizationIds = [organizations[0].id, organizations[1].id];
  });

  afterAll(async () => {
    await Promise.all([store.onModuleDestroy(), prisma.$disconnect()]);
  });

  it('allows only one durable claim for a testnet transaction hash', async () => {
    const evidence = (organizationId: string): NearTransferEvidence => ({
      organizationId,
      referenceId: `reference-${organizationId}`,
      provider: 'near-testnet',
      network: 'testnet',
      transactionHash: `provider-hash-${suffix}`,
      assetId: 'near:testnet:native',
      signerAccountId: 'payer.testnet',
      receiverAccountId: 'merchant.testnet',
      amountAtomic: '1000',
      evidenceDigest:
        '1111111111111111111111111111111111111111111111111111111111111111',
      verifiedAt: new Date().toISOString(),
    });

    const results = await Promise.allSettled([
      store.claim(evidence(organizationIds[0])),
      store.claim(evidence(organizationIds[1])),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'TRANSFER_EVIDENCE_REPLAY' },
    });
    await expect(
      prisma.externalTransferEvidence.count({
        where: {
          provider: 'near-testnet',
          network: 'testnet',
          transactionHash: evidence(organizationIds[0]).transactionHash,
        },
      }),
    ).resolves.toBe(1);
  });
});
