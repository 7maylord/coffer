import {
  InvoiceStatus,
  MembershipRole,
  PaymentStatus,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.upsert({
    where: { email: 'owner@northstar.example' },
    update: { displayName: 'Northstar Owner' },
    create: {
      email: 'owner@northstar.example',
      displayName: 'Northstar Owner',
    },
  });
  const organization = await prisma.organization.upsert({
    where: { slug: 'northstar-studio-demo' },
    update: { name: 'Northstar Studio (Synthetic Demo)' },
    create: {
      slug: 'northstar-studio-demo',
      name: 'Northstar Studio (Synthetic Demo)',
    },
  });
  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: owner.id,
      },
    },
    update: { role: MembershipRole.OWNER },
    create: {
      organizationId: organization.id,
      userId: owner.id,
      role: MembershipRole.OWNER,
    },
  });

  const demoMembers = [
    [
      'finance@northstar.example',
      'Northstar Finance',
      MembershipRole.FINANCE_ADMIN,
    ],
    [
      'approver@northstar.example',
      'Northstar Approver',
      MembershipRole.APPROVER,
    ],
    [
      'operator@northstar.example',
      'Northstar Agent Operator',
      MembershipRole.AGENT_OPERATOR,
    ],
    [
      'employee@northstar.example',
      'Synthetic Employee',
      MembershipRole.EMPLOYEE,
    ],
    ['auditor@northstar.example', 'Northstar Auditor', MembershipRole.AUDITOR],
  ] as const;
  for (const [email, displayName, role] of demoMembers) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { displayName },
      create: { email, displayName },
    });
    await prisma.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: { role, revokedAt: null },
      create: { organizationId: organization.id, userId: user.id, role },
    });
  }

  await prisma.invoice.upsert({
    where: {
      organizationId_invoiceNumber: {
        organizationId: organization.id,
        invoiceNumber: 'DEMO-ISSUED-001',
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      invoiceNumber: 'DEMO-ISSUED-001',
      status: InvoiceStatus.ISSUED,
      currency: 'mock:near:usdc',
      totalAmountAtomic: '12500000',
      publicTokenHash:
        '7d6265f870c55206eb414c28eeda10b65df9c74df09d15c617ea86d81040e7a1',
      payeeDestination: 'northstar-demo.near',
      customer: { displayName: 'Synthetic Customer' },
      lineItems: [
        { description: 'Synthetic design services', amountAtomic: '12500000' },
      ],
      metadata: { classification: 'SYNTHETIC_DEMO' },
      dueDate: new Date('2099-12-31T23:59:59.000Z'),
      issuedAt: new Date('2026-10-30T00:00:00.000Z'),
      createdByUserId: owner.id,
    },
  });

  const quoteId = '00000000-0000-4000-8000-000000001001';
  const paymentId = '00000000-0000-4000-8000-000000001002';
  const caseId = '00000000-0000-4000-8000-000000001003';
  await prisma.quoteSnapshot.upsert({
    where: { id: quoteId },
    update: {},
    create: {
      id: quoteId,
      organizationId: organization.id,
      provider: 'mock',
      sourceAssetId: 'mock:base:usdc',
      destinationAssetId: 'mock:near:usdc',
      amountAtomic: '2500000',
      expectedAmountAtomic: '2500000',
      recipient: 'synthetic-merchant.near',
      refundTo: 'synthetic-payer.near',
      slippageBps: 50,
      confidentiality: 'none',
      scenario: 'unknown',
      requestDigest:
        '8b20fceb1234ea65e3a48536a907653f260f050e2289508763fe681bbff64512',
      expiresAt: new Date('2099-12-31T23:59:59.000Z'),
    },
  });
  await prisma.paymentAttempt.upsert({
    where: { id: paymentId },
    update: {},
    create: {
      id: paymentId,
      organizationId: organization.id,
      quoteId,
      idempotencyKey: 'synthetic-unknown-payment-v1',
      requestDigest:
        '7ac578bdb667fa402c41049604d5431118816485756f66e7f999fe6c78c24111',
      provider: 'mock',
      status: PaymentStatus.UNKNOWN_REQUIRES_RECONCILIATION,
    },
  });
  await prisma.reconciliationCase.upsert({
    where: { paymentAttemptId: paymentId },
    update: {},
    create: {
      id: caseId,
      organizationId: organization.id,
      paymentAttemptId: paymentId,
      reasonCode: 'SYNTHETIC_PROVIDER_STATUS_UNKNOWN',
    },
  });
  await prisma.outboxEvent.upsert({
    where: {
      topic_aggregateId: {
        topic: 'settlement.reconciliation.requested',
        aggregateId: paymentId,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      topic: 'settlement.reconciliation.requested',
      aggregateId: paymentId,
      payload: {
        paymentId,
        reasonCode: 'SYNTHETIC_PROVIDER_STATUS_UNKNOWN',
      },
    },
  });

  process.stdout.write(
    'Seeded Northstar roles, an issued invoice, and an uncertain mock settlement. Import synthetic payroll through the authenticated API.\n',
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Synthetic seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
