// oxlint-disable typescript/unbound-method -- Vitest store methods are spies.
import { AssetRegistry } from '../treasury/asset-registry.js';
import { InvoiceService } from './invoice.service.js';
import {
  InvoiceError,
  type InvoiceStore,
  type InvoiceView,
} from './invoice.types.js';

const now = new Date('2026-10-30T12:00:00.000Z');
const view: InvoiceView = {
  id: 'invoice_1',
  organizationId: 'org_1',
  invoiceNumber: 'INV-001',
  status: 'DRAFT',
  paymentState: 'UNPAID',
  currency: 'mock:near:usdc',
  totalAmountAtomic: '3',
  verifiedReceivedAtomic: '0',
  outstandingAmountAtomic: '3',
  payeeDestination: 'merchant.near',
  customer: { displayName: 'Private Customer', email: 'private@example.test' },
  lineItems: [{ description: 'Service', amountAtomic: '3' }],
  metadata: { privateReference: 'secret-reference' },
  dueDate: '2026-11-30T12:00:00.000Z',
  revision: 1,
  version: 1,
  createdByUserId: 'user_1',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  issuedAt: null,
  expiredAt: null,
  voidedAt: null,
  paidAt: null,
  paymentAttempts: [],
};

describe('InvoiceService', () => {
  const store = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    getPublic: vi.fn(),
    updateDraft: vi.fn(),
    transition: vi.fn(),
  } as unknown as InvoiceStore;
  const service = new InvoiceService(store, new AssetRegistry(), () => now);

  beforeEach(() => vi.clearAllMocks());

  it('calculates exact totals and returns the public token only on creation', async () => {
    vi.mocked(store.create).mockResolvedValueOnce(view);
    const result = await service.create('org_1', 'user_1', {
      invoiceNumber: 'INV-001',
      currency: 'mock:near:usdc',
      payeeDestination: 'merchant.near',
      customer: view.customer,
      lineItems: [
        { description: 'A', amountAtomic: '9007199254740993' },
        { description: 'B', amountAtomic: '7' },
      ],
      metadata: {},
      dueDate: view.dueDate,
    });
    expect(result.publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmountAtomic: '9007199254741000' }),
    );
  });

  it('returns a redacted public view for issued invoices', async () => {
    vi.mocked(store.getPublic).mockResolvedValueOnce({
      ...view,
      status: 'ISSUED',
    });
    const result = await service.publicInvoice('a'.repeat(43));
    expect(result).not.toHaveProperty('customer');
    expect(result).not.toHaveProperty('metadata');
    expect(result).not.toHaveProperty('organizationId');
    expect(JSON.stringify(result)).not.toContain('private@example.test');
  });

  it('rejects invalid assets, past due dates, oversized metadata, and draft public reads', async () => {
    await expect(
      service.create('org_1', 'user_1', {
        invoiceNumber: 'INV-001',
        currency: 'USDC',
        payeeDestination: 'merchant.near',
        customer: view.customer,
        lineItems: view.lineItems,
        metadata: {},
        dueDate: view.dueDate,
      }),
    ).rejects.toBeInstanceOf(InvoiceError);
    await expect(
      service.create('org_1', 'user_1', {
        invoiceNumber: 'INV-001',
        currency: view.currency,
        payeeDestination: 'merchant.near',
        customer: view.customer,
        lineItems: view.lineItems,
        metadata: {},
        dueDate: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(InvoiceError);
    await expect(
      service.update('org_1', 'invoice_1', {
        metadata: Object.fromEntries(
          Array.from({ length: 21 }, (_, index) => [`key${index}`, 'value']),
        ),
      }),
    ).rejects.toBeInstanceOf(InvoiceError);
    await expect(
      service.update('org_1', 'invoice_1', {
        lineItems: [
          { description: 'A', amountAtomic: '9'.repeat(78) },
          { description: 'B', amountAtomic: '1' },
        ],
      }),
    ).rejects.toBeInstanceOf(InvoiceError);
    vi.mocked(store.getPublic).mockResolvedValueOnce(view);
    await expect(service.publicInvoice('a'.repeat(43))).rejects.toMatchObject({
      code: 'INVOICE_NOT_FOUND',
    });
  });

  it('recalculates totals on draft edits and delegates lifecycle transitions', async () => {
    vi.mocked(store.updateDraft).mockResolvedValueOnce(view);
    await service.update('org_1', 'invoice_1', {
      lineItems: [
        { description: 'A', amountAtomic: '4' },
        { description: 'B', amountAtomic: '5' },
      ],
    });
    expect(store.updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ totalAmountAtomic: '9' }),
      }),
    );
    vi.mocked(store.transition).mockResolvedValue(view);
    await service.issue('org_1', 'invoice_1');
    await service.expire('org_1', 'invoice_1');
    await service.void('org_1', 'invoice_1');
    expect(store.transition).toHaveBeenCalledTimes(3);
  });
});
