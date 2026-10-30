import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  ProviderAdapterError,
  type NearTransferEvidence,
  type NearTransferEvidenceStore,
} from './provider-adapter.types.js';

@Injectable()
export class PrismaNearTransferEvidenceStore
  implements NearTransferEvidenceStore, OnModuleDestroy
{
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async claim(evidence: NearTransferEvidence): Promise<NearTransferEvidence> {
    try {
      await this.prisma.externalTransferEvidence.create({
        data: {
          organizationId: evidence.organizationId,
          referenceId: evidence.referenceId,
          provider: evidence.provider,
          network: evidence.network,
          transactionHash: evidence.transactionHash,
          signerAccountId: evidence.signerAccountId,
          receiverAccountId: evidence.receiverAccountId,
          assetId: evidence.assetId,
          amountAtomic: new Prisma.Decimal(evidence.amountAtomic),
          evidenceDigest: evidence.evidenceDigest,
          verifiedAt: new Date(evidence.verifiedAt),
        },
      });
      return structuredClone(evidence);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ProviderAdapterError(
          'TRANSFER_EVIDENCE_REPLAY',
          'Transaction hash or transfer reference was already claimed',
        );
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
