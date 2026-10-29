import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AssetRegistry,
  AssetRegistryError,
} from '../treasury/asset-registry.js';
import {
  INVOICE_STORE,
  InvoiceError,
  type CreateInvoiceInput,
  type InvoiceLineItem,
  type InvoiceStore,
  type InvoiceView,
  type PublicInvoiceView,
  type UpdateInvoiceInput,
} from './invoice.types.js';

@Injectable()
export class InvoiceService {
  private readonly now: () => Date;

  constructor(
    @Inject(INVOICE_STORE) private readonly store: InvoiceStore,
    @Inject(AssetRegistry) private readonly assets: AssetRegistry,
    @Optional() @Inject('INVOICE_CLOCK') now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  async create(
    organizationId: string,
    createdByUserId: string,
    input: CreateInvoiceInput,
  ): Promise<{ invoice: InvoiceView; publicToken: string }> {
    this.requireAsset(input.currency);
    const dueDate = validDueDate(input.dueDate, this.now());
    const totalAmountAtomic = total(input.lineItems);
    validateMetadata(input.metadata);
    const publicToken = randomBytes(32).toString('base64url');
    const invoice = await this.store.create({
      ...input,
      id: randomUUID(),
      organizationId,
      createdByUserId,
      publicTokenHash: hash(publicToken),
      totalAmountAtomic,
      dueDate,
    });
    return { invoice, publicToken };
  }

  list(organizationId: string): Promise<InvoiceView[]> {
    return this.store.list(organizationId);
  }

  async get(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    const invoice = await this.store.get(organizationId, invoiceId);
    if (!invoice)
      throw new InvoiceError('INVOICE_NOT_FOUND', 'Invoice not found');
    return invoice;
  }

  async publicInvoice(publicToken: string): Promise<PublicInvoiceView> {
    const invoice = await this.publicPaymentContext(publicToken);
    return {
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      paymentState: invoice.paymentState,
      currency: invoice.currency,
      totalAmountAtomic: invoice.totalAmountAtomic,
      verifiedReceivedAtomic: invoice.verifiedReceivedAtomic,
      outstandingAmountAtomic: invoice.outstandingAmountAtomic,
      payeeDestination: invoice.payeeDestination,
      lineItems: invoice.lineItems,
      dueDate: invoice.dueDate,
    };
  }

  async publicPaymentContext(publicToken: string): Promise<InvoiceView> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) {
      throw new InvoiceError('INVOICE_NOT_FOUND', 'Invoice not found');
    }
    const invoice = await this.store.getPublic(hash(publicToken));
    if (!invoice || invoice.status === 'DRAFT' || invoice.status === 'VOID') {
      throw new InvoiceError('INVOICE_NOT_FOUND', 'Invoice not found');
    }
    return invoice;
  }

  async update(
    organizationId: string,
    invoiceId: string,
    input: UpdateInvoiceInput,
  ): Promise<InvoiceView> {
    if (input.currency) this.requireAsset(input.currency);
    if (input.metadata) validateMetadata(input.metadata);
    const { dueDate, lineItems, ...patch } = input;
    return this.store.updateDraft({
      organizationId,
      invoiceId,
      patch: {
        ...patch,
        ...(lineItems ? { lineItems } : {}),
        ...(lineItems ? { totalAmountAtomic: total(lineItems) } : {}),
        ...(dueDate ? { dueDate: validDueDate(dueDate, this.now()) } : {}),
      },
    });
  }

  issue(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.store.transition({
      organizationId,
      invoiceId,
      action: 'ISSUE',
      now: this.now(),
    });
  }

  expire(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.store.transition({
      organizationId,
      invoiceId,
      action: 'EXPIRE',
      now: this.now(),
    });
  }

  void(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    return this.store.transition({
      organizationId,
      invoiceId,
      action: 'VOID',
      now: this.now(),
    });
  }

  private requireAsset(assetId: string): void {
    try {
      this.assets.require(assetId);
    } catch (error) {
      if (error instanceof AssetRegistryError) {
        throw new InvoiceError(
          'INVALID_INVOICE',
          'Invoice currency must be a canonical asset',
        );
      }
      throw error;
    }
  }
}

function total(lineItems: InvoiceLineItem[]): string {
  const amount = lineItems
    .reduce((sum, item) => sum + BigInt(item.amountAtomic), 0n)
    .toString();
  if (amount.length > 78) {
    throw new InvoiceError('INVALID_INVOICE', 'Invoice total is too large');
  }
  return amount;
}

function validDueDate(value: string, now: Date): Date {
  const dueDate = new Date(value);
  if (
    !Number.isFinite(dueDate.getTime()) ||
    dueDate.getTime() <= now.getTime()
  ) {
    throw new InvoiceError(
      'INVALID_INVOICE',
      'Invoice due date must be in the future',
    );
  }
  return dueDate;
}

function validateMetadata(metadata: Record<string, string>): void {
  if (Object.keys(metadata).length > 20) {
    throw new InvoiceError('INVALID_INVOICE', 'Invoice metadata is too large');
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
