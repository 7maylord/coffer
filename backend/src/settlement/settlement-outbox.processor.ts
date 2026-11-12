import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  JournalSide,
  LedgerAccountType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { LedgerService } from '../treasury/ledger.service.js';
import {
  SETTLEMENT_OPERATIONS,
  type SettlementOperations,
} from './settlement.store.js';

type ClaimedEvent = {
  id: string;
  organizationId: string;
  topic: string;
  aggregateId: string;
  payload: unknown;
  claimToken: string;
};

const postingPayloadSchema = z
  .object({
    postingId: z.string().uuid(),
    paymentId: z.string().uuid(),
    kind: z.enum(['SETTLEMENT', 'REFUND']),
    assetId: z.string().min(1),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();

@Injectable()
export class SettlementOutboxProcessor implements OnModuleDestroy {
  private readonly prisma: PrismaClient;
  private stopping = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(APP_ENVIRONMENT) environment: AppEnvironment,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(SETTLEMENT_OPERATIONS)
    private readonly settlement: SettlementOperations,
  ) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  start(): void {
    this.loop ??= this.run();
  }

  async drainOnce(now = new Date()): Promise<boolean> {
    const event = await this.claim(now);
    if (!event) return false;
    try {
      await this.process(event, now);
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          claimToken: event.claimToken,
          publishedAt: null,
        },
        data: {
          publishedAt: now,
          claimedAt: null,
          claimToken: null,
          lastErrorCode: null,
        },
      });
      return true;
    } catch (error) {
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          claimToken: event.claimToken,
          publishedAt: null,
        },
        data: {
          claimedAt: null,
          claimToken: null,
          availableAt: new Date(now.getTime() + 30_000),
          lastErrorCode:
            error instanceof z.ZodError
              ? 'INVALID_OUTBOX_PAYLOAD'
              : 'DELIVERY_FAILED',
        },
      });
      throw error;
    }
  }

  private async claim(now: Date): Promise<ClaimedEvent | null> {
    const claimToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
          AND "topic" IN (
            'settlement.poll.requested',
            'settlement.reconciliation.requested',
            'settlement.posting.requested'
          )
          AND "availableAt" <= ${now}
          AND ("claimedAt" IS NULL OR "claimedAt" < ${new Date(now.getTime() - 5 * 60_000)})
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      if (!rows[0]) return null;
      const event = await tx.outboxEvent.update({
        where: { id: rows[0].id },
        data: { claimedAt: now, claimToken, attempts: { increment: 1 } },
      });
      return { ...event, claimToken };
    });
  }

  private async process(event: ClaimedEvent, now: Date): Promise<void> {
    if (event.topic === 'settlement.posting.requested') {
      await this.postLedger(event, now);
      return;
    }
    const payload = z
      .object({ paymentId: z.string().uuid() })
      .passthrough()
      .parse(event.payload);
    await this.settlement.poll(event.organizationId, payload.paymentId);
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        if (!(await this.drainOnce())) await delay(1000);
      } catch {
        await delay(1000);
      }
    }
  }

  private async postLedger(event: ClaimedEvent, now: Date): Promise<void> {
    const payload = postingPayloadSchema.parse(event.payload);
    const posting = await this.prisma.settlementPosting.findFirst({
      where: { id: payload.postingId, organizationId: event.organizationId },
    });
    if (!posting) throw new Error('Settlement posting not found');
    if (posting.journalId) return;

    const prefix = payload.kind === 'SETTLEMENT' ? 'SETTLEMENT' : 'REFUND';
    const cash = await this.ledger.ensureAccount({
      organizationId: event.organizationId,
      assetId: payload.assetId,
      code: `${prefix}_CASH`,
      name: `${prefix} cash`,
      accountType: LedgerAccountType.ASSET,
    });
    const clearing = await this.ledger.ensureAccount({
      organizationId: event.organizationId,
      assetId: payload.assetId,
      code: `${prefix}_CLEARING`,
      name: `${prefix} clearing`,
      accountType: LedgerAccountType.REVENUE,
    });
    const result = await this.ledger.post({
      organizationId: event.organizationId,
      assetId: payload.assetId,
      reference: `settlement:${posting.id}`,
      description: `${payload.kind.toLowerCase()} for payment ${payload.paymentId}`,
      lines: [
        {
          accountId: cash.id,
          side: JournalSide.DEBIT,
          amountAtomic: payload.amountAtomic,
        },
        {
          accountId: clearing.id,
          side: JournalSide.CREDIT,
          amountAtomic: payload.amountAtomic,
        },
      ],
    });
    await this.prisma.settlementPosting.updateMany({
      where: { id: posting.id, journalId: null },
      data: { journalId: result.journal.id, completedAt: now },
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.loop;
    await this.prisma.$disconnect();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
