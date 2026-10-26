import { randomBytes, createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import {
  ORGANIZATION_STORE,
  type OrganizationStore,
} from './organization.types.js';

const inviteLifetimeMilliseconds = 24 * 60 * 60 * 1000;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const inviteRoles = [
  'finance_admin',
  'approver',
  'agent_operator',
  'employee',
  'auditor',
  'viewer',
] as const;
export type InviteRole = (typeof inviteRoles)[number];

const databaseRole: Readonly<Record<InviteRole, MembershipRole>> = {
  finance_admin: MembershipRole.FINANCE_ADMIN,
  approver: MembershipRole.APPROVER,
  agent_operator: MembershipRole.AGENT_OPERATOR,
  employee: MembershipRole.EMPLOYEE,
  auditor: MembershipRole.AUDITOR,
  viewer: MembershipRole.VIEWER,
};

const apiRole = (role: MembershipRole) => role.toLowerCase();

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(ORGANIZATION_STORE) private readonly store: OrganizationStore,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async create(userId: string, input: { slug: string; name: string }) {
    const organization = await this.store.createOrganization({
      userId,
      ...input,
    });
    if (!organization) throw new ConflictException('Organization slug exists');
    return { ...organization, role: apiRole(organization.role) };
  }

  async list(userId: string) {
    return (await this.store.listOrganizations(userId)).map((organization) => ({
      ...organization,
      role: apiRole(organization.role),
    }));
  }

  async invite(
    principal: SessionPrincipal,
    organizationId: string,
    input: { targetNearAccountId: string; role: InviteRole },
    now = new Date(),
  ) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + inviteLifetimeMilliseconds);
    const created = await this.store.createInvite({
      organizationId,
      invitedByUserId: principal.userId,
      network: this.environment.NEAR_NETWORK,
      targetNearAccountId: input.targetNearAccountId,
      role: databaseRole[input.role],
      tokenHash: digest(token),
      expiresAt,
    });
    if (!created) throw new NotFoundException();
    return {
      inviteId: created.id,
      token,
      network: this.environment.NEAR_NETWORK,
      targetNearAccountId: input.targetNearAccountId,
      role: input.role,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async accept(principal: SessionPrincipal, token: string, now = new Date()) {
    const accepted = await this.store.acceptInvite({
      tokenHash: digest(token),
      userId: principal.userId,
      wallets: principal.wallets,
      now,
    });
    if (!accepted) throw new NotFoundException();
    return { ...accepted, role: apiRole(accepted.role) };
  }

  async members(organizationId: string) {
    return (await this.store.listMembers(organizationId)).map((member) => ({
      ...member,
      role: apiRole(member.role),
    }));
  }

  async revokeMember(
    principal: SessionPrincipal,
    organizationId: string,
    targetUserId: string,
    now = new Date(),
  ) {
    if (targetUserId === principal.userId) throw new NotFoundException();
    const revoked = await this.store.revokeMember({
      organizationId,
      actorUserId: principal.userId,
      targetUserId,
      now,
    });
    if (!revoked) throw new NotFoundException();
    return { status: 'revoked' };
  }
}
