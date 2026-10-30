import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { InvoiceStatus, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  InvoiceError,
  type InvoiceStore,
  type InvoiceView,
} from './invoice.types.js';

const customerSchema = z
  .object({ displayName: z.string(), email: z.string().optional() })
  .strict();
const lineItemsSchema = z.array(
  z.object({ description: z.string(), amountAtomic: z.string() }).strict(),
);
const metadataSchema = z.record(z.string(), z.string());

@Injectable()
export class PrismaInvoiceStore implements InvoiceStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async create(
    input: Parameters<InvoiceStore['create']>[0],
  ): Promise<InvoiceView> {
    try {
      const invoice = await this.prisma.invoice.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          createdByUserId: input.createdByUserId,
          publicTokenHash: input.publicTokenHash,
          invoiceNumber: input.invoiceNumber,
          currency: input.currency,
          totalAmountAtomic: new Prisma.Decimal(input.totalAmountAtomic),
          payeeDestination: input.payeeDestination,
          customer: json(input.customer),
          lineItems: json(input.lineItems),
          metadata: json(input.metadata),
          dueDate: input.dueDate,
        },
        include: invoiceInclude,
      });
      return mapInvoice(invoice);
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new InvoiceError(
          'INVOICE_NUMBER_CONFLICT',
          'Invoice number already exists',
        );
      }
      throw error;
    }
  }

  async list(organizationId: string): Promise<InvoiceView[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: invoiceInclude,
    });
    return invoices.map(mapInvoice);
  }

  async get(
    organizationId: string,
    invoiceId: string,
  ): Promise<InvoiceView | null> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: invoiceInclude,
    });
    return invoice ? mapInvoice(invoice) : null;
  }

  async getPublic(publicTokenHash: string): Promise<InvoiceView | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { publicTokenHash },
      include: invoiceInclude,
    });
    return invoice ? mapInvoice(invoice) : null;
  }

  async updateDraft(
    input: Parameters<InvoiceStore['updateDraft']>[0],
  ): Promise<InvoiceView> {
    try {
      return await this.serializable(async (tx) => {
        await lockInvoice(tx, input.organizationId, input.invoiceId);
        const current = await findInvoice(
          tx,
          input.organizationId,
          input.invoiceId,
        );
        if (current.status !== InvoiceStatus.DRAFT) {
          throw new InvoiceError(
            'INVOICE_STATE_CONFLICT',
            'Only draft invoices can be edited',
          );
        }
        const patch = input.patch;
        const invoice = await tx.invoice.update({
          where: { id: current.id },
          data: {
            invoiceNumber: patch.invoiceNumber,
            currency: patch.currency,
            totalAmountAtomic: patch.totalAmountAtomic
              ? new Prisma.Decimal(patch.totalAmountAtomic)
              : undefined,
            payeeDestination: patch.payeeDestination,
            customer: patch.customer ? json(patch.customer) : undefined,
            lineItems: patch.lineItems ? json(patch.lineItems) : undefined,
            metadata: patch.metadata ? json(patch.metadata) : undefined,
            dueDate: patch.dueDate,
            revision: { increment: 1 },
            version: { increment: 1 },
          },
          include: invoiceInclude,
        });
        return mapInvoice(invoice);
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new InvoiceError(
          'INVOICE_NUMBER_CONFLICT',
          'Invoice number already exists',
        );
      }
      throw error;
    }
  }

  transition(
    input: Parameters<InvoiceStore['transition']>[0],
  ): Promise<InvoiceView> {
    return this.serializable(async (tx) => {
      await lockInvoice(tx, input.organizationId, input.invoiceId);
      const current = await findInvoice(
        tx,
        input.organizationId,
        input.invoiceId,
      );
      const data: Prisma.InvoiceUpdateInput = { version: { increment: 1 } };
      if (input.action === 'ISSUE') {
        if (current.status !== InvoiceStatus.DRAFT) {
          throw new InvoiceError(
            'INVOICE_STATE_CONFLICT',
            'Only draft invoices can be issued',
          );
        }
        if (current.dueDate.getTime() <= input.now.getTime()) {
          throw new InvoiceError(
            'INVOICE_NOT_DUE',
            'Invoice due date has passed',
          );
        }
        data.status = InvoiceStatus.ISSUED;
        data.issuedAt = input.now;
      } else if (input.action === 'EXPIRE') {
        if (current.status !== InvoiceStatus.ISSUED) {
          throw new InvoiceError(
            'INVOICE_STATE_CONFLICT',
            'Only issued invoices can expire',
          );
        }
        if (current.dueDate.getTime() > input.now.getTime()) {
          throw new InvoiceError('INVOICE_NOT_DUE', 'Invoice is not due yet');
        }
        data.status = InvoiceStatus.EXPIRED;
        data.expiredAt = input.now;
      } else {
        if (
          current.status !== InvoiceStatus.DRAFT &&
          current.status !== InvoiceStatus.ISSUED
        ) {
          throw new InvoiceError(
            'INVOICE_STATE_CONFLICT',
            'Invoice cannot be voided',
          );
        }
        data.status = InvoiceStatus.VOID;
        data.voidedAt = input.now;
      }
      return mapInvoice(
        await tx.invoice.update({
          where: { id: current.id },
          data,
          include: invoiceInclude,
        }),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (!serializationConflict(error) || attempt === 4) throw error;
      }
    }
    throw new Error('Unreachable serializable transaction retry');
  }
}

const invoiceInclude = {
  paymentAttempts: {
    orderBy: { createdAt: 'asc' as const },
    include: { quote: true },
  },
} as const;
type InvoiceRecord = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

async function findInvoice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
): Promise<InvoiceRecord> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: invoiceInclude,
  });
  if (!invoice)
    throw new InvoiceError('INVOICE_NOT_FOUND', 'Invoice not found');
  return invoice;
}

async function lockInvoice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`,
  );
}

function mapInvoice(invoice: InvoiceRecord): InvoiceView {
  const customer = parseStored(customerSchema, invoice.customer);
  const lineItems = parseStored(lineItemsSchema, invoice.lineItems);
  const metadata = parseStored(metadataSchema, invoice.metadata);
  const totalAmountAtomic = invoice.totalAmountAtomic.toFixed(0);
  const verifiedReceivedAtomic = invoice.verifiedReceivedAtomic.toFixed(0);
  const total = BigInt(totalAmountAtomic);
  const received = BigInt(verifiedReceivedAtomic);
  const outstanding = total > received ? total - received : 0n;
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    paymentState:
      received === 0n
        ? 'UNPAID'
        : received < total
          ? 'PARTIALLY_PAID'
          : received === total
            ? 'PAID'
            : 'OVERPAID',
    currency: invoice.currency,
    totalAmountAtomic,
    verifiedReceivedAtomic,
    outstandingAmountAtomic: outstanding.toString(),
    payeeDestination: invoice.payeeDestination,
    customer,
    lineItems,
    metadata,
    dueDate: invoice.dueDate.toISOString(),
    revision: invoice.revision,
    version: invoice.version,
    createdByUserId: invoice.createdByUserId,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    expiredAt: invoice.expiredAt?.toISOString() ?? null,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    paymentAttempts: invoice.paymentAttempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      amountAtomic: attempt.quote.expectedAmountAtomic.toFixed(0),
      assetId: attempt.quote.destinationAssetId,
      createdAt: attempt.createdAt.toISOString(),
      settledAt: attempt.settledAt?.toISOString() ?? null,
    })),
  };
}

function parseStored<T>(schema: z.ZodType<T>, value: Prisma.JsonValue): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new InvoiceError('INVALID_INVOICE', 'Stored invoice data is invalid');
  return result.data;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function knownPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function serializationConflict(error: unknown): boolean {
  return (
    knownPrismaError(error, 'P2034') ||
    (error instanceof Error &&
      /could not serialize|deadlock detected/i.test(error.message))
  );
}
