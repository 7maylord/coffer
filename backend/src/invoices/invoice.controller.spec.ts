// oxlint-disable typescript/unbound-method -- Vitest service methods are spies.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import {
  InvoiceController,
  PublicInvoiceController,
} from './invoice.controller.js';
import type { InvoiceService } from './invoice.service.js';
import { InvoiceError } from './invoice.types.js';
import type { SettlementOperations } from '../settlement/settlement.store.js';

const body = {
  invoiceNumber: 'INV-001',
  currency: 'mock:near:usdc',
  payeeDestination: 'merchant.near',
  customer: { displayName: 'Customer', email: 'customer@example.test' },
  lineItems: [{ description: 'Service', amountAtomic: '1000' }],
  metadata: {},
  dueDate: '2026-11-30T12:00:00.000Z',
};

describe('InvoiceController', () => {
  const service = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    issue: vi.fn(),
    expire: vi.fn(),
    void: vi.fn(),
    publicInvoice: vi.fn(),
    publicPaymentContext: vi.fn(),
  } as unknown as InvoiceService;
  const settlement = {
    supportedAssets: vi.fn(() => [
      { id: 'mock:base:usdc', chain: 'base-mock', decimals: 6 },
      { id: 'mock:near:usdc', chain: 'near-mock', decimals: 6 },
    ]),
    createQuote: vi.fn(),
    initiate: vi.fn(),
    getAttempt: vi.fn(),
    poll: vi.fn(),
  } as unknown as SettlementOperations;
  const controller = new InvoiceController(service);
  const publicController = new PublicInvoiceController(service, settlement);
  const request = {
    [AUTH_PRINCIPAL]: {
      sessionId: 'session_1',
      userId: 'user_1',
      expiresAt: new Date(),
      wallets: [],
      memberships: [],
    },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => vi.clearAllMocks());

  it('validates and delegates create, list, and get', async () => {
    vi.mocked(service.create).mockResolvedValueOnce({} as never);
    await controller.create(request, 'org_1', body);
    expect(service.create).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      expect.objectContaining({ invoiceNumber: 'INV-001' }),
    );
    vi.mocked(service.list).mockResolvedValueOnce([]);
    await expect(controller.list('org_1')).resolves.toEqual([]);
    vi.mocked(service.get).mockResolvedValueOnce({ id: 'invoice_1' } as never);
    await expect(controller.get('org_1', 'invoice_1')).resolves.toMatchObject({
      id: 'invoice_1',
    });
  });

  it('delegates draft edits and every lifecycle action', async () => {
    vi.mocked(service.update).mockResolvedValueOnce({} as never);
    await controller.update('org_1', 'invoice_1', {
      lineItems: [{ description: 'Updated', amountAtomic: '2' }],
    });
    expect(service.update).toHaveBeenCalled();
    vi.mocked(service.issue).mockResolvedValueOnce({} as never);
    vi.mocked(service.expire).mockResolvedValueOnce({} as never);
    vi.mocked(service.void).mockResolvedValueOnce({} as never);
    await controller.issue('org_1', 'invoice_1');
    await controller.expire('org_1', 'invoice_1');
    await controller.void('org_1', 'invoice_1');
    expect(service.issue).toHaveBeenCalledWith('org_1', 'invoice_1');
    expect(service.expire).toHaveBeenCalledWith('org_1', 'invoice_1');
    expect(service.void).toHaveBeenCalledWith('org_1', 'invoice_1');
  });

  it('rejects malformed create and empty update bodies', async () => {
    await expect(controller.create(request, 'org_1', {})).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.update('org_1', 'invoice_1', {})).rejects.toThrow(
      BadRequestException,
    );
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });

  it('maps missing invoices to 404 and invalid invoices to 400', async () => {
    vi.mocked(service.get).mockRejectedValueOnce(
      new InvoiceError('INVOICE_NOT_FOUND', 'missing'),
    );
    await expect(controller.get('org_1', 'invoice_1')).rejects.toThrow(
      NotFoundException,
    );
    vi.mocked(service.create).mockRejectedValueOnce(
      new InvoiceError('INVALID_INVOICE', 'invalid'),
    );
    await expect(controller.create(request, 'org_1', body)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each([
    'INVOICE_NUMBER_CONFLICT',
    'INVOICE_STATE_CONFLICT',
    'INVOICE_NOT_DUE',
  ] as const)('maps %s to 409', async (code) => {
    vi.mocked(service.issue).mockRejectedValueOnce(
      new InvoiceError(code, 'conflict'),
    );
    await expect(controller.issue('org_1', 'invoice_1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('does not swallow unexpected errors', async () => {
    const unexpected = new Error('unexpected');
    vi.mocked(service.get).mockRejectedValueOnce(unexpected);
    await expect(controller.get('org_1', 'invoice_1')).rejects.toBe(unexpected);
  });

  it('serves public invoices and hides every token failure as 404', async () => {
    vi.mocked(service.publicInvoice).mockResolvedValueOnce({
      invoiceNumber: 'INV-001',
    } as never);
    await expect(
      publicController.getInvoice('a'.repeat(43)),
    ).resolves.toMatchObject({
      invoiceNumber: 'INV-001',
    });
    vi.mocked(service.publicInvoice).mockRejectedValueOnce(
      new InvoiceError('INVOICE_NOT_FOUND', 'missing'),
    );
    await expect(publicController.getInvoice('bad')).rejects.toThrow(
      NotFoundException,
    );
    const unexpected = new Error('unexpected');
    vi.mocked(service.publicInvoice).mockRejectedValueOnce(unexpected);
    await expect(publicController.getInvoice('bad')).rejects.toBe(unexpected);
  });

  it('derives public quote authority from the invoice and redacts internal IDs', async () => {
    vi.mocked(service.publicPaymentContext).mockResolvedValueOnce({
      id: '22222222-2222-4222-8222-222222222222',
      organizationId: '11111111-1111-4111-8111-111111111111',
      currency: 'mock:near:usdc',
      outstandingAmountAtomic: '12500000',
      payeeDestination: 'merchant.near',
    } as never);
    vi.mocked(settlement.createQuote).mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333',
      organizationId: '11111111-1111-4111-8111-111111111111',
      invoiceId: '22222222-2222-4222-8222-222222222222',
      sourceAssetId: 'mock:base:usdc',
      destinationAssetId: 'mock:near:usdc',
      amountAtomic: '12500000',
      expectedAmountAtomic: '12500000',
      recipient: 'merchant.near',
      refundTo: 'payer.near',
      slippageBps: 50,
      confidentiality: 'none',
      scenario: 'success',
      provider: 'mock',
      expiresAt: '2026-11-01T12:10:00.000Z',
      requestDigest: 'secret-internal-digest',
    });

    const quote = await publicController.createQuote('a'.repeat(43), {
      sourceAssetId: 'mock:base:usdc',
      refundTo: 'payer.near',
      slippageBps: 50,
      scenario: 'success',
    });

    expect(settlement.createQuote).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        invoiceId: '22222222-2222-4222-8222-222222222222',
        amountAtomic: '12500000',
        destinationAssetId: 'mock:near:usdc',
        recipient: 'merchant.near',
      }),
    );
    expect(quote).not.toHaveProperty('organizationId');
    expect(quote).not.toHaveProperty('invoiceId');
    expect(quote).not.toHaveProperty('requestDigest');
  });

  it('binds public authorization and reads to the token invoice', async () => {
    const invoice = {
      id: '22222222-2222-4222-8222-222222222222',
      organizationId: '11111111-1111-4111-8111-111111111111',
    } as never;
    vi.mocked(service.publicPaymentContext).mockResolvedValue(invoice);
    vi.mocked(settlement.initiate).mockResolvedValueOnce({
      id: '44444444-4444-4444-8444-444444444444',
      organizationId: '11111111-1111-4111-8111-111111111111',
      invoiceId: '22222222-2222-4222-8222-222222222222',
      quoteId: '33333333-3333-4333-8333-333333333333',
      provider: 'mock',
      scenario: 'success',
      status: 'AWAITING_DEPOSIT',
      version: 1,
      settlementPostingCount: 0,
      refundPostingCount: 0,
      pollCount: 0,
      history: [],
    });

    const attempt = await publicController.initiate(
      'a'.repeat(43),
      'payer-request-1',
      { quoteId: '33333333-3333-4333-8333-333333333333' },
    );
    expect(settlement.initiate).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'payer-request-1',
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(attempt).not.toHaveProperty('organizationId');
    expect(attempt).not.toHaveProperty('invoiceId');

    vi.mocked(settlement.getAttempt).mockResolvedValueOnce({
      ...attempt,
      organizationId: '11111111-1111-4111-8111-111111111111',
      invoiceId: '55555555-5555-4555-8555-555555555555',
    });
    await expect(
      publicController.getPayment(
        'a'.repeat(43),
        '44444444-4444-4444-8444-444444444444',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
