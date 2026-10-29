export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'EXPIRED' | 'VOID' | 'PAID';
export type InvoicePaymentState =
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERPAID';

export type InvoiceCustomer = {
  displayName: string;
  email?: string;
};

export type InvoiceLineItem = {
  description: string;
  amountAtomic: string;
};

export type InvoicePaymentAttempt = {
  id: string;
  status: string;
  amountAtomic: string;
  assetId: string;
  createdAt: string;
  settledAt: string | null;
};

export type InvoiceView = {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  paymentState: InvoicePaymentState;
  currency: string;
  totalAmountAtomic: string;
  verifiedReceivedAtomic: string;
  outstandingAmountAtomic: string;
  payeeDestination: string;
  customer: InvoiceCustomer;
  lineItems: InvoiceLineItem[];
  metadata: Record<string, string>;
  dueDate: string;
  revision: number;
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  expiredAt: string | null;
  voidedAt: string | null;
  paidAt: string | null;
  paymentAttempts: InvoicePaymentAttempt[];
};

export type PublicInvoiceView = Pick<
  InvoiceView,
  | 'invoiceNumber'
  | 'status'
  | 'paymentState'
  | 'currency'
  | 'totalAmountAtomic'
  | 'verifiedReceivedAtomic'
  | 'outstandingAmountAtomic'
  | 'payeeDestination'
  | 'lineItems'
  | 'dueDate'
>;

export type CreateInvoiceInput = {
  invoiceNumber: string;
  currency: string;
  payeeDestination: string;
  customer: InvoiceCustomer;
  lineItems: InvoiceLineItem[];
  metadata: Record<string, string>;
  dueDate: string;
};

export type UpdateInvoiceInput = Partial<CreateInvoiceInput>;

export class InvoiceError extends Error {
  constructor(
    readonly code:
      | 'INVOICE_NOT_FOUND'
      | 'INVOICE_NUMBER_CONFLICT'
      | 'INVOICE_STATE_CONFLICT'
      | 'INVOICE_NOT_DUE'
      | 'INVALID_INVOICE',
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceError';
  }
}

export interface InvoiceStore {
  create(input: {
    id: string;
    organizationId: string;
    createdByUserId: string;
    publicTokenHash: string;
    invoiceNumber: string;
    currency: string;
    totalAmountAtomic: string;
    payeeDestination: string;
    customer: InvoiceCustomer;
    lineItems: InvoiceLineItem[];
    metadata: Record<string, string>;
    dueDate: Date;
  }): Promise<InvoiceView>;
  list(organizationId: string): Promise<InvoiceView[]>;
  get(organizationId: string, invoiceId: string): Promise<InvoiceView | null>;
  getPublic(publicTokenHash: string): Promise<InvoiceView | null>;
  updateDraft(input: {
    organizationId: string;
    invoiceId: string;
    patch: {
      invoiceNumber?: string;
      currency?: string;
      totalAmountAtomic?: string;
      payeeDestination?: string;
      customer?: InvoiceCustomer;
      lineItems?: InvoiceLineItem[];
      metadata?: Record<string, string>;
      dueDate?: Date;
    };
  }): Promise<InvoiceView>;
  transition(input: {
    organizationId: string;
    invoiceId: string;
    action: 'ISSUE' | 'EXPIRE' | 'VOID';
    now: Date;
  }): Promise<InvoiceView>;
}

export const INVOICE_STORE = Symbol('INVOICE_STORE');
