import type { MembershipRole } from '@prisma/client';

export const ORGANIZATION_STORE = Symbol('ORGANIZATION_STORE');

export interface OrganizationStore {
  createOrganization(input: {
    userId: string;
    slug: string;
    name: string;
  }): Promise<{
    id: string;
    slug: string;
    name: string;
    role: MembershipRole;
  } | null>;
  listOrganizations(
    userId: string,
  ): Promise<
    Array<{ id: string; slug: string; name: string; role: MembershipRole }>
  >;
  createInvite(input: {
    organizationId: string;
    invitedByUserId: string;
    network: string;
    targetNearAccountId: string;
    role: MembershipRole;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string } | null>;
  acceptInvite(input: {
    tokenHash: string;
    userId: string;
    wallets: Array<{ network: string; accountId: string }>;
    now: Date;
  }): Promise<{ organizationId: string; role: MembershipRole } | null>;
  listMembers(organizationId: string): Promise<
    Array<{
      userId: string;
      displayName: string;
      role: MembershipRole;
      wallets: Array<{ network: string; accountId: string }>;
    }>
  >;
  revokeMember(input: {
    organizationId: string;
    actorUserId: string;
    targetUserId: string;
    now: Date;
  }): Promise<boolean>;
}
