import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { MembershipRole, Prisma, PrismaClient } from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type { OrganizationStore } from './organization.types.js';

@Injectable()
export class PrismaOrganizationStore
  implements OrganizationStore, OnModuleDestroy
{
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async createOrganization(input: {
    userId: string;
    slug: string;
    name: string;
  }) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const organization = await transaction.organization.create({
          data: { slug: input.slug, name: input.name },
        });
        await transaction.membership.create({
          data: {
            organizationId: organization.id,
            userId: input.userId,
            role: MembershipRole.OWNER,
          },
        });
        return { ...organization, role: MembershipRole.OWNER };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  async listOrganizations(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, revokedAt: null },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(({ organization, role }) => ({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      role,
    }));
  }

  createInvite(input: Parameters<OrganizationStore['createInvite']>[0]) {
    return this.prisma.$transaction(async (transaction) => {
      const owner = await transaction.membership.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: input.invitedByUserId,
          role: MembershipRole.OWNER,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!owner) return null;
      return transaction.organizationInvite.create({
        data: input,
        select: { id: true },
      });
    });
  }

  acceptInvite(input: Parameters<OrganizationStore['acceptInvite']>[0]) {
    return this.prisma.$transaction(
      async (transaction) => {
        const invite = await transaction.organizationInvite.findUnique({
          where: { tokenHash: input.tokenHash },
        });
        if (
          !invite ||
          invite.acceptedAt ||
          invite.revokedAt ||
          invite.expiresAt.getTime() <= input.now.getTime() ||
          !input.wallets.some(
            (wallet) =>
              wallet.network === invite.network &&
              wallet.accountId === invite.targetNearAccountId,
          )
        ) {
          return null;
        }
        const consumed = await transaction.organizationInvite.updateMany({
          where: {
            id: invite.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
          data: { acceptedAt: input.now },
        });
        if (consumed.count !== 1) return null;
        const membership = await transaction.membership.upsert({
          where: {
            organizationId_userId: {
              organizationId: invite.organizationId,
              userId: input.userId,
            },
          },
          update: { role: invite.role, revokedAt: null },
          create: {
            organizationId: invite.organizationId,
            userId: input.userId,
            role: invite.role,
          },
          select: { organizationId: true, role: true },
        });
        return membership;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async listMembers(organizationId: string) {
    const members = await this.prisma.membership.findMany({
      where: { organizationId, revokedAt: null },
      include: { user: { include: { walletAccounts: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map(({ userId, role, user }) => ({
      userId,
      displayName: user.displayName,
      role,
      wallets: user.walletAccounts.map(({ network, accountId }) => ({
        network,
        accountId,
      })),
    }));
  }

  revokeMember(input: Parameters<OrganizationStore['revokeMember']>[0]) {
    return this.prisma.$transaction(async (transaction) => {
      const owner = await transaction.membership.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: input.actorUserId,
          role: MembershipRole.OWNER,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!owner) return false;
      const result = await transaction.membership.updateMany({
        where: {
          organizationId: input.organizationId,
          userId: input.targetUserId,
          role: { not: MembershipRole.OWNER },
          revokedAt: null,
        },
        data: { revokedAt: input.now },
      });
      return result.count === 1;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
