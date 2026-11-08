import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  type IntentsSwapRecord,
  type IntentsSwapStore,
} from './intents-swap.service.js';
import type {
  IntentsStatus,
  OneClickStatus,
} from './provider-adapter.types.js';
import { SettlementError } from './settlement.types.js';

@Injectable()
export class PrismaIntentsSwapStore
  implements IntentsSwapStore, OnModuleDestroy
{
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async findByIdempotency(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<IntentsSwapRecord | null> {
    const record = await this.prisma.intentsSwap.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
    });
    return record ? mapRecord(record) : null;
  }

  async create(record: IntentsSwapRecord): Promise<IntentsSwapRecord> {
    try {
      return mapRecord(
        await this.prisma.intentsSwap.create({
          data: {
            id: record.id,
            organizationId: record.organizationId,
            createdByUserId: record.createdByUserId,
            provider: record.provider,
            environment: record.environment,
            idempotencyKey: record.idempotencyKey,
            requestDigest: record.requestDigest,
            correlationId: record.correlationId,
            originAssetId: record.originAssetId,
            destinationAssetId: record.destinationAssetId,
            originTokenContract: record.originTokenContract,
            depositType: record.depositType,
            amountInAtomic: new Prisma.Decimal(record.amountInAtomic),
            amountOutAtomic: new Prisma.Decimal(record.amountOutAtomic),
            minAmountOutAtomic: new Prisma.Decimal(record.minAmountOutAtomic),
            recipient: record.recipient,
            refundTo: record.refundTo,
            slippageBps: record.slippageBps,
            depositAddress: record.depositAddress,
            deadline: new Date(record.deadline),
            signatureVerified: record.signatureVerified,
            providerStatus: record.providerStatus,
            internalStatus: record.internalStatus,
          },
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByIdempotency(
          record.organizationId,
          record.idempotencyKey,
        );
        if (existing && existing.requestDigest === record.requestDigest) {
          return existing;
        }
        throw new SettlementError(
          'IDEMPOTENCY_CONFLICT',
          'Swap idempotency key or provider quote was already used',
        );
      }
      throw error;
    }
  }

  async get(
    organizationId: string,
    swapId: string,
  ): Promise<IntentsSwapRecord> {
    const record = await this.prisma.intentsSwap.findFirst({
      where: { id: swapId, organizationId },
    });
    if (!record)
      throw new SettlementError('PAYMENT_NOT_FOUND', 'Swap not found');
    return mapRecord(record);
  }

  async recordDeposit(
    organizationId: string,
    swapId: string,
    transactionHash: string,
  ): Promise<IntentsSwapRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.intentsSwap.findFirst({
        where: { id: swapId, organizationId },
      });
      if (!current)
        throw new SettlementError('PAYMENT_NOT_FOUND', 'Swap not found');
      if (
        current.depositTransactionHash &&
        current.depositTransactionHash !== transactionHash
      ) {
        throw new SettlementError(
          'IDEMPOTENCY_CONFLICT',
          'Swap deposit transaction cannot be replaced',
        );
      }
      return mapRecord(
        await tx.intentsSwap.update({
          where: { id: current.id },
          data: {
            depositTransactionHash: transactionHash,
            internalStatus: 'DEPOSIT_OBSERVED',
            version: { increment: current.depositTransactionHash ? 0 : 1 },
          },
        }),
      );
    });
  }

  async recordStatus(
    organizationId: string,
    swapId: string,
    status: IntentsStatus,
  ): Promise<IntentsSwapRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.intentsSwap.findFirst({
        where: { id: swapId, organizationId },
      });
      if (!current)
        throw new SettlementError('PAYMENT_NOT_FOUND', 'Swap not found');
      const providerEventId = `${status.correlationId}:${status.status}:${status.updatedAt}`;
      await tx.intentsSwapObservation.upsert({
        where: {
          intentsSwapId_providerEventId: {
            intentsSwapId: current.id,
            providerEventId,
          },
        },
        create: {
          intentsSwapId: current.id,
          providerEventId,
          providerStatus: status.status,
          signatureVerified: status.signatureVerified,
          controlledPayload: {
            amountInAtomic: status.amountInAtomic ?? null,
            amountOutAtomic: status.amountOutAtomic ?? null,
            refundedAmountAtomic: status.refundedAmountAtomic ?? null,
            originChainTransactionHashes: status.originChainTransactionHashes,
            destinationChainTransactionHashes:
              status.destinationChainTransactionHashes,
          },
          observedAt: new Date(status.updatedAt),
        },
        update: {},
      });
      return mapRecord(
        await tx.intentsSwap.update({
          where: { id: current.id },
          data: {
            providerStatus: status.status,
            internalStatus: internalStatus(
              status.status,
              Boolean(current.depositTransactionHash),
            ),
            signatureVerified: status.signatureVerified,
            providerUpdatedAt: new Date(status.updatedAt),
            version: { increment: 1 },
          },
        }),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

type RecordRow = Awaited<ReturnType<PrismaClient['intentsSwap']['findFirst']>>;

function mapRecord(record: NonNullable<RecordRow>): IntentsSwapRecord {
  return {
    id: record.id,
    organizationId: record.organizationId,
    createdByUserId: record.createdByUserId,
    provider: 'tidepool',
    environment: 'testnet',
    idempotencyKey: record.idempotencyKey,
    requestDigest: record.requestDigest,
    correlationId: record.correlationId,
    originAssetId: record.originAssetId,
    destinationAssetId: record.destinationAssetId,
    originTokenContract: record.originTokenContract,
    depositType: record.depositType as IntentsSwapRecord['depositType'],
    amountInAtomic: record.amountInAtomic.toFixed(0),
    amountOutAtomic: record.amountOutAtomic.toFixed(0),
    minAmountOutAtomic: record.minAmountOutAtomic.toFixed(0),
    recipient: record.recipient,
    refundTo: record.refundTo,
    slippageBps: record.slippageBps,
    depositAddress: record.depositAddress,
    deadline: record.deadline.toISOString(),
    signatureVerified: record.signatureVerified,
    ...(record.depositTransactionHash
      ? { depositTransactionHash: record.depositTransactionHash }
      : {}),
    providerStatus: record.providerStatus as OneClickStatus,
    internalStatus:
      record.internalStatus as IntentsSwapRecord['internalStatus'],
    ...(record.providerUpdatedAt
      ? { providerUpdatedAt: record.providerUpdatedAt.toISOString() }
      : {}),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function internalStatus(
  status: OneClickStatus,
  depositRecorded: boolean,
): IntentsSwapRecord['internalStatus'] {
  return {
    PENDING_DEPOSIT: depositRecorded ? 'DEPOSIT_OBSERVED' : 'AWAITING_DEPOSIT',
    KNOWN_DEPOSIT_TX: 'DEPOSIT_OBSERVED',
    PROCESSING: 'PROCESSING',
    SUCCESS: 'UNVERIFIED_SUCCESS',
    INCOMPLETE_DEPOSIT: 'UNDERFUNDED',
    REFUNDED: 'REFUNDED',
    FAILED: 'FAILED',
  }[status] as IntentsSwapRecord['internalStatus'];
}
