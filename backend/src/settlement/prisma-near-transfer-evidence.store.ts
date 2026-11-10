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
        const existing = await this.prisma.externalTransferEvidence.findFirst({
          where: {
            OR: [
              {
                provider: evidence.provider,
                network: evidence.network,
                transactionHash: evidence.transactionHash,
              },
              {
                organizationId: evidence.organizationId,
                referenceId: evidence.referenceId,
              },
            ],
          },
        });
        if (
          existing?.organizationId === evidence.organizationId &&
          existing.referenceId === evidence.referenceId &&
          existing.provider === evidence.provider &&
          existing.network === evidence.network &&
          existing.transactionHash === evidence.transactionHash &&
          existing.signerAccountId === evidence.signerAccountId &&
          existing.receiverAccountId === evidence.receiverAccountId &&
          existing.assetId === evidence.assetId &&
          existing.amountAtomic.toFixed(0) === evidence.amountAtomic &&
          existing.evidenceDigest === evidence.evidenceDigest
        ) {
          return structuredClone(evidence);
        }
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
