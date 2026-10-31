import {
  LedgerAccountType,
  LedgerNormalSide,
  PrismaClient,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { parseEnvironment } from '../src/config/env.js';
import { PrismaAutomationStore } from '../src/automation/prisma-automation.store.js';
import { AutomationError } from '../src/automation/automation.types.js';
import {
  MOCK_VENDOR_ID,
  MOCK_VENDOR_RECIPIENT_COMMITMENT,
} from '../src/automation/mock-vendor.adapter.js';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('automation persistence invariants', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const store = new PrismaAutomationStore(
    parseEnvironment({ DATABASE_URL: databaseUrl }),
  );
  const suffix = randomUUID();
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;
  let accountId: string;
  let invoiceId: string;
  let agentId: string;
  let offerId: string;

  beforeAll(async () => {
    const [organization, otherOrganization, user] = await Promise.all([
      prisma.organization.create({
        data: { slug: `automation-${suffix}`, name: 'Automation Fixture' },
      }),
      prisma.organization.create({
        data: {
          slug: `automation-other-${suffix}`,
          name: 'Automation Other',
        },
      }),
      prisma.user.create({ data: { displayName: 'Automation Operator' } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    userId = user.id;
    const account = await prisma.ledgerAccount.create({
      data: {
        organizationId,
        assetId: 'mock:base:usdc',
        code: 'AUTOMATION_CASH',
        name: 'Automation Cash',
        accountType: LedgerAccountType.ASSET,
        normalSide: LedgerNormalSide.DEBIT,
        postedBalanceAtomic: 10_000_000,
      },
    });
    accountId = account.id;
    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        invoiceNumber: `AUTO-${suffix}`,
        currency: 'mock:base:usdc',
        totalAmountAtomic: 1_000_000,
        publicTokenHash: randomUUID().replaceAll('-', ''),
        payeeDestination: 'merchant.test',
        customer: { displayName: 'Synthetic Customer' },
        lineItems: [
          { description: 'Synthetic service', amountAtomic: '1000000' },
        ],
        metadata: {},
        dueDate: new Date(Date.now() + 86_400_000),
        createdByUserId: userId,
      },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await prisma.agentPurchase.deleteMany({ where: { organizationId } });
    await prisma.serviceOffer.deleteMany({ where: { organizationId } });
    await prisma.agentIdentity.deleteMany({ where: { organizationId } });
    await prisma.cfoAllocationProposal.deleteMany({
      where: { organizationId },
    });
    await prisma.cfoInferenceRun.deleteMany({ where: { organizationId } });
    await prisma.invoice.deleteMany({ where: { organizationId } });
    await prisma.ledgerAccount.deleteMany({ where: { organizationId } });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT set_config('coffer.audit_reset', 'on', true)",
      );
      await tx.auditEvent.deleteMany({ where: { organizationId } });
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
    await Promise.all([store.onModuleDestroy(), prisma.$disconnect()]);
  });

  it('stores only digests and scoped metadata for valid and failed inference runs', async () => {
    const records = await store.scopedInvoiceRecords(organizationId, [
      invoiceId,
    ]);
    expect(records).toEqual([
      expect.objectContaining({
        id: invoiceId,
        assetId: 'mock:base:usdc',
        amountAtomic: '1000000',
      }),
    ]);
    await expect(
      store.scopedInvoiceRecords(otherOrganizationId, [invoiceId]),
    ).resolves.toEqual([]);

    const proposal = await store.createCfoProposal({
      organizationId,
      actorUserId: userId,
      provider: 'fixture-ai',
      model: 'fixture/model',
      inputDigest: '1'.repeat(64),
      responseDigest: '2'.repeat(64),
      attestationStatus: 'UNVERIFIED',
      sourceAccountId: accountId,
      assetId: 'mock:base:usdc',
      maximumAmountAtomic: '1000000',
      allocations: [
        {
          category: 'Operations',
          amountAtomic: '1000000',
          reason: 'Fixture',
          supportingRecordIds: [invoiceId],
          confidenceBps: 5000,
          uncertainty: 'Fixture',
        },
      ],
      supportingRecordIds: [invoiceId],
    });
    expect(proposal).toMatchObject({
      organizationId,
      provider: 'fixture-ai',
      status: 'PENDING',
    });
    await expect(
      store.cfoProposal(otherOrganizationId, proposal.id),
    ).resolves.toBeNull();
    await expect(store.cfoProposals(organizationId)).resolves.toEqual([
      expect.objectContaining({ id: proposal.id }),
    ]);
    await expect(store.cfoProposals(otherOrganizationId)).resolves.toEqual([]);

    await store.recordInferenceFailure({
      organizationId,
      actorUserId: userId,
      provider: 'fixture-ai',
      model: 'fixture/model',
      inputDigest: '3'.repeat(64),
      attestationStatus: 'UNAVAILABLE',
      status: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    const failed = await prisma.cfoInferenceRun.findFirstOrThrow({
      where: { organizationId, inputDigest: '3'.repeat(64) },
    });
    expect(failed).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
      responseDigest: null,
    });
  });

  it('atomically blocks duplicate offers and rolling-budget oversubscription', async () => {
    const agent = await store.createAgent({
      organizationId,
      ownerUserId: userId,
      purpose: 'Bounded fixture agent',
      allowedActions: ['purchase:document-classification'],
      assetId: 'mock:base:usdc',
      chainId: 'mock:base',
      maxAmountAtomic: '1000000',
      rollingBudgetAtomic: '1500000',
      rollingWindowSeconds: 86_400,
      vendorAllowlist: [MOCK_VENDOR_ID],
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    agentId = agent.id;
    const offer = await store.createOffer({
      organizationId,
      agentId,
      offerDigest: '4'.repeat(64),
      offer: vendorOffer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    });
    offerId = offer.id;
    const claims = await Promise.allSettled(
      [0, 1].map(() =>
        store.claimPurchase({
          organizationId,
          agentId,
          offerId,
          requestDigest: '5'.repeat(64),
          now: new Date(),
        }),
      ),
    );
    expect(claims.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = claims.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'PURCHASE_DUPLICATE' }),
    });
    await expect(store.offers(organizationId)).resolves.toEqual([
      expect.objectContaining({ id: offerId }),
    ]);
    await expect(store.purchases(organizationId)).resolves.toEqual([
      expect.objectContaining({ agentId, offerId }),
    ]);
    await expect(store.purchases(otherOrganizationId)).resolves.toEqual([]);

    const secondOffer = await store.createOffer({
      organizationId,
      agentId,
      offerDigest: '6'.repeat(64),
      offer: vendorOffer('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    });
    await expect(
      store.claimPurchase({
        organizationId,
        agentId,
        offerId: secondOffer.id,
        requestDigest: '7'.repeat(64),
        now: new Date(),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AutomationError>>({
        code: 'PURCHASE_BUDGET_EXCEEDED',
      }),
    );
  });

  it('expires commitments outside the configured rolling budget window', async () => {
    const rollingAgent = await store.createAgent({
      organizationId,
      ownerUserId: userId,
      purpose: 'Short rolling window fixture',
      allowedActions: ['purchase:document-classification'],
      assetId: 'mock:base:usdc',
      chainId: 'mock:base',
      maxAmountAtomic: '1000000',
      rollingBudgetAtomic: '1000000',
      rollingWindowSeconds: 60,
      vendorAllowlist: [MOCK_VENDOR_ID],
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const oldOffer = await store.createOffer({
      organizationId,
      agentId: rollingAgent.id,
      offerDigest: '8'.repeat(64),
      offer: vendorOffer('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    });
    await prisma.agentPurchase.create({
      data: {
        organizationId,
        agentId: rollingAgent.id,
        offerId: oldOffer.id,
        status: 'COMPLETED',
        requestDigest: '9'.repeat(64),
        completedAt: new Date(Date.now() - 120_000),
        createdAt: new Date(Date.now() - 120_000),
      },
    });
    const currentOffer = await store.createOffer({
      organizationId,
      agentId: rollingAgent.id,
      offerDigest: 'a'.repeat(64),
      offer: vendorOffer('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    });
    await expect(
      store.claimPurchase({
        organizationId,
        agentId: rollingAgent.id,
        offerId: currentOffer.id,
        requestDigest: 'b'.repeat(64),
        now: new Date(),
      }),
    ).resolves.toMatchObject({ status: 'CLAIMED' });
  });

  it('rejects database updates to offer and agent authority fields', async () => {
    await expect(
      prisma.serviceOffer.update({
        where: { id: offerId },
        data: { priceAtomic: 1 },
      }),
    ).rejects.toThrow('append-only');
    await expect(
      prisma.agentIdentity.update({
        where: { id: agentId },
        data: { rollingBudgetAtomic: 999_999_999 },
      }),
    ).rejects.toThrow('authority fields cannot change');
  });

  it('revocation is tenant-scoped and immediately visible', async () => {
    await expect(
      store.revokeAgent(otherOrganizationId, agentId, new Date()),
    ).resolves.toBeNull();
    await expect(
      store.revokeAgent(organizationId, agentId, new Date()),
    ).resolves.toMatchObject({ status: 'REVOKED' });
  });
});

function vendorOffer(externalOfferId: string) {
  return {
    vendorId: MOCK_VENDOR_ID,
    externalOfferId,
    serviceCode: 'document-classification',
    requestDigest: randomUUID().replaceAll('-', '').repeat(2),
    assetId: 'mock:base:usdc',
    chainId: 'mock:base',
    priceAtomic: '1000000',
    recipientCommitment: MOCK_VENDOR_RECIPIENT_COMMITMENT,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    controlledTerms: {
      documentCount: 10,
      classificationProfile: 'standard' as const,
      deliverable: 'classification-labels' as const,
    },
  };
}
