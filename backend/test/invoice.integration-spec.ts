import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { InvoiceService } from '../src/invoices/invoice.service.js';
import { PrismaInvoiceStore } from '../src/invoices/prisma-invoice.store.js';
import { MockSettlementAdapter } from '../src/settlement/mock-settlement.adapter.js';
import { PrismaSettlementStore } from '../src/settlement/prisma-settlement.store.js';
import { SettlementService } from '../src/settlement/settlement.service.js';
import { AssetRegistry } from '../src/treasury/asset-registry.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';

describe('invoice persistence and settlement', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const invoiceStore = new PrismaInvoiceStore(environment);
  const settlementStore = new PrismaSettlementStore(environment);
  const suffix = randomUUID().slice(0, 8);
  let now = new Date('2026-10-30T12:00:00.000Z');
  const invoices = new InvoiceService(
    invoiceStore,
    new AssetRegistry(),
    () => now,
  );
  const settlement = new SettlementService(
    settlementStore,
    new MockSettlementAdapter({ now: () => now }),
    () => now,
  );
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;

  beforeAll(async () => {
    const [organization, otherOrganization, user] = await Promise.all([
      prisma.organization.create({
        data: { slug: `invoice-${suffix}`, name: 'Invoice Fixture' },
      }),
      prisma.organization.create({
        data: {
          slug: `invoice-other-${suffix}`,
          name: 'Other Invoice Fixture',
        },
      }),
      prisma.user.create({
        data: {
          email: `invoice-${suffix}@example.test`,
          displayName: 'Invoice Finance User',
        },
      }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    userId = user.id;
  });

  afterAll(async () => {
    await Promise.all([
      invoiceStore.onModuleDestroy(),
      settlementStore.onModuleDestroy(),
      prisma.$disconnect(),
    ]);
  });

  const createDraft = async (label: string, lineAmounts: string[] = ['1000']) =>
    invoices.create(organizationId, userId, {
      invoiceNumber: `INV-${label}-${suffix}`,
      currency: 'mock:near:usdc',
      payeeDestination: 'merchant.near',
      customer: {
        displayName: 'Private Customer',
        email: 'customer-private@example.test',
      },
      lineItems: lineAmounts.map((amountAtomic, index) => ({
        description: `Synthetic service ${index + 1}`,
        amountAtomic,
      })),
      metadata: { internalReference: `private-${label}` },
      dueDate: '2026-11-30T12:00:00.000Z',
    });

  const issue = async (label: string, lineAmounts: string[] = ['1000']) => {
    const created = await createDraft(label, lineAmounts);
    const invoice = await invoices.issue(organizationId, created.invoice.id);
    return { ...created, invoice };
  };

  const quoteAndInitiate = async (
    invoiceId: string,
    amountAtomic: string,
    scenario: Parameters<MockSettlementAdapter['createQuote']>[1]['scenario'],
    key: string,
  ) => {
    const quote = await settlement.createQuote(organizationId, {
      invoiceId,
      sourceAssetId: 'mock:base:usdc',
      destinationAssetId: 'mock:near:usdc',
      amountAtomic,
      recipient: 'merchant.near',
      refundTo: 'payer.near',
      slippageBps: 50,
      confidentiality: 'none',
      scenario,
    });
    return settlement.initiate(organizationId, key, quote.id);
  };

  it('creates exact drafts, replaces draft lines, and freezes issued material', async () => {
    const created = await createDraft('EDIT', ['9007199254740993', '7']);
    expect(created.invoice).toMatchObject({
      status: 'DRAFT',
      totalAmountAtomic: '9007199254741000',
      revision: 1,
    });
    expect(created.publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const edited = await invoices.update(organizationId, created.invoice.id, {
      lineItems: [{ description: 'Replacement', amountAtomic: '25' }],
    });
    expect(edited).toMatchObject({ totalAmountAtomic: '25', revision: 2 });
    await invoices.issue(organizationId, edited.id);
    await expect(
      invoices.update(organizationId, edited.id, {
        lineItems: [{ description: 'Forbidden edit', amountAtomic: '30' }],
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_STATE_CONFLICT' });
    await expect(createDraft('EDIT')).rejects.toMatchObject({
      code: 'INVOICE_NUMBER_CONFLICT',
    });
  });

  it('serves only redacted issued data and keeps tenant reads scoped', async () => {
    const created = await issue('PUBLIC');
    const publicView = await invoices.publicInvoice(created.publicToken);
    expect(publicView).toMatchObject({
      invoiceNumber: `INV-PUBLIC-${suffix}`,
      status: 'ISSUED',
      outstandingAmountAtomic: '1000',
    });
    expect(JSON.stringify(publicView)).not.toMatch(
      /customer-private|private-PUBLIC|organizationId|createdByUserId/i,
    );
    await expect(
      invoices.get(otherOrganizationId, created.invoice.id),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    const draft = await createDraft('PRIVATE');
    await expect(
      invoices.publicInvoice(draft.publicToken),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
  });

  it('J-01 links multiple attempts and marks paid only after verified net received reaches total', async () => {
    const created = await issue('PAY', ['400', '600']);
    await expect(
      settlement.createQuote(organizationId, {
        invoiceId: created.invoice.id,
        sourceAssetId: 'mock:base:usdc',
        destinationAssetId: 'mock:near:usdc',
        amountAtomic: '100',
        recipient: 'wrong.near',
        refundTo: 'payer.near',
        slippageBps: 0,
        confidentiality: 'none',
        scenario: 'success',
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_QUOTE_MISMATCH' });

    const first = await quoteAndInitiate(
      created.invoice.id,
      '400',
      'success',
      `invoice-first-${suffix}`,
    );
    await settlement.poll(organizationId, first.id);
    await settlement.poll(organizationId, first.id);
    await settlement.poll(organizationId, first.id);
    await expect(
      invoices.get(organizationId, created.invoice.id),
    ).resolves.toMatchObject({
      status: 'ISSUED',
      paymentState: 'PARTIALLY_PAID',
      verifiedReceivedAtomic: '400',
      outstandingAmountAtomic: '600',
      paymentAttempts: [
        expect.objectContaining({ id: first.id, status: 'SETTLED' }),
      ],
    });

    const second = await quoteAndInitiate(
      created.invoice.id,
      '600',
      'success',
      `invoice-second-${suffix}`,
    );
    await settlement.poll(organizationId, second.id);
    await settlement.poll(organizationId, second.id);
    await settlement.poll(organizationId, second.id);
    const paid = await invoices.get(organizationId, created.invoice.id);
    expect(paid).toMatchObject({
      status: 'PAID',
      paymentState: 'PAID',
      verifiedReceivedAtomic: '1000',
      outstandingAmountAtomic: '0',
    });
    expect(paid.paymentAttempts).toHaveLength(2);
  });

  it('credits a direct NEAR invoice only after exact verified evidence', async () => {
    const created = await invoices.create(organizationId, userId, {
      invoiceNumber: `INV-NEAR-${suffix}`,
      currency: 'near:testnet:native',
      payeeDestination: 'merchant.testnet',
      customer: { displayName: 'NEAR Customer' },
      lineItems: [{ description: 'Service', amountAtomic: '1000' }],
      metadata: {},
      dueDate: '2026-11-30T12:00:00.000Z',
    });
    await invoices.issue(organizationId, created.invoice.id);
    const quoteId = randomUUID();
    await settlementStore.createQuote({
      id: quoteId,
      organizationId,
      invoiceId: created.invoice.id,
      provider: 'near-testnet',
      sourceAssetId: 'near:testnet:native',
      destinationAssetId: 'near:testnet:native',
      amountAtomic: '1000',
      expectedAmountAtomic: '1000',
      recipient: 'merchant.testnet',
      refundTo: 'payer.testnet',
      slippageBps: 0,
      confidentiality: 'none',
      scenario: 'success',
      requestDigest: 'a'.repeat(64),
      expiresAt: '2026-11-30T12:00:00.000Z',
    });
    const attempt = await settlementStore.initiate({
      organizationId,
      idempotencyKey: `near-invoice-${suffix}`,
      quoteId,
      requiredInvoiceId: created.invoice.id,
      requestDigest: 'b'.repeat(64),
      now,
      provider: 'near-testnet',
      operation: 'INVOICE_NEAR_TESTNET_TRANSFER',
      queuePoll: false,
    });
    const observed = await settlementStore.observe({
      organizationId,
      paymentId: attempt.id,
      observation: {
        eventId: `direct-${suffix}`,
        providerStatus: 'SUCCESS',
        verified: true,
        amountAtomic: '1000',
        assetId: 'near:testnet:native',
        recipient: 'merchant.testnet',
      },
      now,
    });
    expect(observed).toMatchObject({
      status: 'SETTLED',
      settlementPostingCount: 1,
    });
    await expect(
      invoices.get(organizationId, created.invoice.id),
    ).resolves.toMatchObject({
      status: 'PAID',
      paymentState: 'PAID',
      verifiedReceivedAtomic: '1000',
    });
    await expect(
      prisma.outboxEvent.count({
        where: {
          organizationId,
          topic: 'settlement.poll.requested',
          payload: { path: ['paymentId'], equals: attempt.id },
        },
      }),
    ).resolves.toBe(0);
  });

  it('records concurrent valid attempts as overpaid when verified receipts exceed the invoice total', async () => {
    const created = await issue('OVERPAID');
    const [first, second] = await Promise.all([
      quoteAndInitiate(
        created.invoice.id,
        '700',
        'success',
        `invoice-overpaid-first-${suffix}`,
      ),
      quoteAndInitiate(
        created.invoice.id,
        '700',
        'success',
        `invoice-overpaid-second-${suffix}`,
      ),
    ]);

    for (const attempt of [first, second]) {
      await settlement.poll(organizationId, attempt.id);
      await settlement.poll(organizationId, attempt.id);
      await settlement.poll(organizationId, attempt.id);
    }

    await expect(
      invoices.get(organizationId, created.invoice.id),
    ).resolves.toMatchObject({
      status: 'PAID',
      paymentState: 'OVERPAID',
      verifiedReceivedAtomic: '1400',
      outstandingAmountAtomic: '0',
    });
  });

  it.each([
    ['unknown', 1, 'UNKNOWN_REQUIRES_RECONCILIATION'],
    ['partial_deposit', 2, 'UNDERFUNDED'],
    ['refund', 3, 'REFUNDED'],
  ] as const)(
    'keeps an invoice unpaid for %s settlement',
    async (scenario, polls, expectedStatus) => {
      const created = await issue(scenario.toUpperCase());
      const attempt = await quoteAndInitiate(
        created.invoice.id,
        '1000',
        scenario,
        `invoice-${scenario}-${suffix}`,
      );
      for (let index = 0; index < polls; index += 1) {
        await settlement.poll(organizationId, attempt.id);
      }
      await expect(
        invoices.get(organizationId, created.invoice.id),
      ).resolves.toMatchObject({
        status: 'ISSUED',
        paymentState: 'UNPAID',
        verifiedReceivedAtomic: '0',
        paymentAttempts: [expect.objectContaining({ status: expectedStatus })],
      });
    },
  );

  it('supports explicit void and due-date expiry without a paid transition', async () => {
    const voidable = await issue('VOID');
    await expect(
      invoices.void(organizationId, voidable.invoice.id),
    ).resolves.toMatchObject({ status: 'VOID' });
    const expirable = await issue('EXPIRE');
    now = new Date('2026-12-01T12:00:00.000Z');
    await expect(
      invoices.expire(organizationId, expirable.invoice.id),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
  });
});
