import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type {
  AuthStore,
  ConsumeChallengeInput,
  SessionPrincipal,
  StoredAuthChallenge,
} from './auth.types.js';

@Injectable()
export class PrismaAuthStore implements AuthStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async createChallenge(challenge: StoredAuthChallenge): Promise<void> {
    await this.prisma.authChallenge.create({ data: challenge });
  }

  findChallenge(id: string): Promise<StoredAuthChallenge | null> {
    return this.prisma.authChallenge.findUnique({ where: { id } });
  }

  consumeChallengeAndCreateSession(
    input: ConsumeChallengeInput,
  ): Promise<{ sessionId: string; userId: string } | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const consumed = await transaction.authChallenge.updateMany({
          where: {
            id: input.challengeId,
            network: input.network,
            nonceHash: input.nonceHash,
            stateHash: input.stateHash,
            consumedAt: null,
            expiresAt: { gt: input.now },
          },
          data: { consumedAt: input.now },
        });
        if (consumed.count !== 1) return null;

        const wallet = await transaction.walletAccount.upsert({
          where: {
            network_accountId: {
              network: input.network,
              accountId: input.accountId,
            },
          },
          update: {
            lastPublicKey: input.publicKey,
            verifiedAt: input.now,
          },
          create: {
            network: input.network,
            accountId: input.accountId,
            lastPublicKey: input.publicKey,
            verifiedAt: input.now,
            user: { create: { displayName: input.accountId } },
          },
          select: { userId: true },
        });
        const session = await transaction.authSession.create({
          data: {
            userId: wallet.userId,
            tokenHash: input.sessionTokenHash,
            csrfTokenHash: input.csrfTokenHash,
            expiresAt: input.sessionExpiresAt,
          },
          select: { id: true },
        });
        return { sessionId: session.id, userId: wallet.userId };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<SessionPrincipal | null> {
    const session = await this.prisma.authSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: {
          include: {
            walletAccounts: true,
            memberships: { where: { revokedAt: null } },
          },
        },
      },
    });
    if (!session) return null;
    return {
      sessionId: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      wallets: session.user.walletAccounts.map(({ network, accountId }) => ({
        network,
        accountId,
      })),
      memberships: session.user.memberships.map(({ organizationId, role }) => ({
        organizationId,
        role,
      })),
    };
  }

  async revokeSession(
    tokenHash: string,
    csrfTokenHash: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        tokenHash,
        csrfTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
    return result.count === 1;
  }

  async hasActiveSessionWithCsrf(
    tokenHash: string,
    csrfTokenHash: string,
    now: Date,
  ): Promise<boolean> {
    return (
      (await this.prisma.authSession.count({
        where: {
          tokenHash,
          csrfTokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      })) === 1
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
