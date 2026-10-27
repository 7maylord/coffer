import { Prisma, PrismaClient } from '@prisma/client';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';

const prisma = new PrismaClient();

describe('database invariants', () => {
  const suffix = Date.now().toString();
  let organizationId: string;
  let userId: string | undefined;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { slug: `integration-${suffix}`, name: 'Integration Test Org' },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { organizationId } });
    await prisma.idempotencyRecord.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('enforces tenant-scoped idempotency uniqueness', async () => {
    const record = {
      organizationId,
      operation: 'SETTLEMENT_INITIATE',
      key: 'same-key',
      requestDigest: 'digest-one',
    };
    await prisma.idempotencyRecord.create({ data: record });

    await expect(
      prisma.idempotencyRecord.create({
        data: { ...record, requestDigest: 'digest-two' },
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
    } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });

  it('stores atomic money beyond JavaScript safe integer range exactly', async () => {
    const user = await prisma.user.create({
      data: {
        email: `integration-${suffix}@example.test`,
        displayName: 'Integration User',
      },
    });
    userId = user.id;
    const amountAtomic = '900719925474099312345678901234567890';
    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        invoiceNumber: `INV-${suffix}`,
        currency: 'MOCK_USDC',
        totalAmountAtomic: amountAtomic,
        publicTokenHash: `hash-${suffix}`,
        payeeDestination: 'merchant.near',
        customer: { displayName: 'Synthetic customer' },
        lineItems: [{ description: 'Synthetic service', amountAtomic }],
        metadata: {},
        dueDate: new Date('2026-12-01T00:00:00.000Z'),
        createdByUserId: user.id,
      },
    });

    expect(invoice.totalAmountAtomic.toFixed(0)).toBe(amountAtomic);
  });
});
