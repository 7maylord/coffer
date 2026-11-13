import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FinancialProposalStatus,
  MembershipRole,
  Prisma,
  PrismaClient,
  type FinancialProposal,
  type ProposalApproval,
} from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  type ActivePolicy,
  PolicyAuthorizationError,
  PolicyConflictError,
  PolicyNotFoundError,
  type PolicyStore,
  type ProposalRecord,
  type PolicyRules,
} from './policy.types.js';

type ProposalWithApprovals = FinancialProposal & {
  approvals: ProposalApproval[];
};

@Injectable()
export class PrismaPolicyStore implements PolicyStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async activatePolicy(
    input: Parameters<PolicyStore['activatePolicy']>[0],
  ): Promise<ActivePolicy> {
    try {
      return await this.serializable(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "Organization"
          WHERE "id" = ${input.organizationId}::uuid FOR UPDATE
        `;
        const membership = await transaction.membership.findFirst({
          where: {
            organizationId: input.organizationId,
            userId: input.actorUserId,
            role: MembershipRole.OWNER,
            revokedAt: null,
          },
          select: { id: true },
        });
        if (!membership) throw new PolicyAuthorizationError('Owner required');
        const current = await transaction.policyDefinition.findFirst({
          where: { organizationId: input.organizationId, supersededAt: null },
          orderBy: { version: 'desc' },
        });
        if (current?.digest === input.digest) return mapPolicy(current);
        if (current) {
          await transaction.policyDefinition.update({
            where: { id: current.id },
            data: { supersededAt: input.now },
          });
          await transaction.financialProposal.updateMany({
            where: {
              organizationId: input.organizationId,
              status: {
                in: [
                  FinancialProposalStatus.PENDING,
                  FinancialProposalStatus.APPROVED,
                ],
              },
            },
            data: {
              status: FinancialProposalStatus.STALE_POLICY,
              version: { increment: 1 },
            },
          });
        }
        const policy = await transaction.policyDefinition.create({
          data: {
            organizationId: input.organizationId,
            version: (current?.version ?? 0) + 1,
            digest: input.digest,
            rules: json(input.rules),
            createdByUserId: input.actorUserId,
          },
        });
        return mapPolicy(policy);
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new PolicyConflictError('Policy version changed concurrently');
      }
      throw error;
    }
  }

  async activePolicy(organizationId: string): Promise<ActivePolicy | null> {
    const policy = await this.prisma.policyDefinition.findFirst({
      where: { organizationId, supersededAt: null },
      orderBy: { version: 'desc' },
    });
    return policy ? mapPolicy(policy) : null;
  }

  async rollingCommitted(
    input: Parameters<PolicyStore['rollingCommitted']>[0],
  ): Promise<string> {
    const result = await this.prisma.financialProposal.aggregate({
      where: {
        organizationId: input.organizationId,
        assetId: input.assetId,
        createdAt: { gte: input.since },
        status: {
          in: [
            FinancialProposalStatus.PENDING,
            FinancialProposalStatus.APPROVED,
          ],
        },
      },
      _sum: { amountAtomic: true },
    });
    return result._sum.amountAtomic?.toFixed(0) ?? '0';
  }

  async recordDecision(
    input: Parameters<PolicyStore['recordDecision']>[0],
  ): Promise<void> {
    await this.prisma.policyDecision.create({
      data: {
        organizationId: input.organizationId,
        policyDefinitionId: input.policyDefinitionId,
        actorUserId: input.actorUserId,
        outcome: input.decision.outcome,
        reasonCodes: json(input.decision.reasonCodes),
        inputsDigest: input.decision.inputsDigest,
        inputSummary: json(input.inputSummary),
      },
    });
  }

  async createProposal(
    input: Parameters<PolicyStore['createProposal']>[0],
  ): Promise<ProposalRecord> {
    try {
      return await this.serializable(async (transaction) => {
        await lockOrganization(transaction, input.proposal.organizationId);
        await assertCurrentPolicy(transaction, input.proposal);
        await assertRollingCapacity(transaction, input);
        const proposal = await transaction.financialProposal.create({
          data: proposalData(input.proposal),
          include: { approvals: true },
        });
        await createDecision(transaction, proposal.id, input);
        return mapProposal(proposal);
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new PolicyConflictError('Proposal commitment already exists');
      }
      throw error;
    }
  }

  async reviseProposal(
    input: Parameters<PolicyStore['reviseProposal']>[0],
  ): Promise<ProposalRecord> {
    try {
      return await this.serializable(async (transaction) => {
        await lockOrganization(transaction, input.proposal.organizationId);
        await assertCurrentPolicy(transaction, input.proposal);
        await lockProposal(
          transaction,
          input.proposal.organizationId,
          input.previousId,
        );
        const previous = await transaction.financialProposal.findFirst({
          where: {
            id: input.previousId,
            organizationId: input.proposal.organizationId,
          },
        });
        if (!previous) throw new PolicyNotFoundError('Proposal not found');
        if (previous.status === FinancialProposalStatus.SUPERSEDED) {
          throw new PolicyConflictError('Proposal is already superseded');
        }
        await assertRollingCapacity(transaction, input, previous.id);
        await transaction.financialProposal.update({
          where: { id: previous.id },
          data: {
            status: FinancialProposalStatus.SUPERSEDED,
            version: { increment: 1 },
          },
        });
        const proposal = await transaction.financialProposal.create({
          data: { ...proposalData(input.proposal), supersedesId: previous.id },
          include: { approvals: true },
        });
        await createDecision(transaction, proposal.id, input);
        return mapProposal(proposal);
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new PolicyConflictError('Proposal revision already exists');
      }
      throw error;
    }
  }

  async proposal(
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalRecord | null> {
    const proposal = await this.prisma.financialProposal.findFirst({
      where: { id: proposalId, organizationId },
      include: { approvals: { orderBy: { createdAt: 'asc' } } },
    });
    return proposal ? mapProposal(proposal) : null;
  }

  async proposalByKey(
    organizationId: string,
    proposalKey: string,
    revision: number,
  ): Promise<ProposalRecord | null> {
    const proposal = await this.prisma.financialProposal.findUnique({
      where: {
        organizationId_proposalKey_revision: {
          organizationId,
          proposalKey,
          revision,
        },
      },
      include: { approvals: { orderBy: { createdAt: 'asc' } } },
    });
    return proposal ? mapProposal(proposal) : null;
  }

  async proposals(organizationId: string): Promise<ProposalRecord[]> {
    const proposals = await this.prisma.financialProposal.findMany({
      where: { organizationId },
      include: { approvals: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return proposals.map(mapProposal);
  }

  async cancelProposal(
    input: Parameters<PolicyStore['cancelProposal']>[0],
  ): Promise<ProposalRecord> {
    return this.serializable(async (transaction) => {
      await lockProposal(transaction, input.organizationId, input.proposalId);
      const proposal = await transaction.financialProposal.findFirst({
        where: {
          id: input.proposalId,
          organizationId: input.organizationId,
        },
        include: { approvals: true },
      });
      if (!proposal) throw new PolicyNotFoundError('Proposal not found');
      if (proposal.status === FinancialProposalStatus.CANCELLED) {
        return mapProposal(proposal);
      }
      if (proposal.status !== FinancialProposalStatus.PENDING) {
        throw new PolicyConflictError(
          'Only a pending proposal can be cancelled',
        );
      }
      return mapProposal(
        await transaction.financialProposal.update({
          where: { id: proposal.id },
          data: {
            status: FinancialProposalStatus.CANCELLED,
            version: { increment: 1 },
          },
          include: { approvals: { orderBy: { createdAt: 'asc' } } },
        }),
      );
    });
  }

  async addApproval(
    input: Parameters<PolicyStore['addApproval']>[0],
  ): Promise<ProposalRecord> {
    try {
      return await this.serializable(async (transaction) => {
        await lockProposal(transaction, input.organizationId, input.proposalId);
        const proposal = await transaction.financialProposal.findFirst({
          where: { id: input.proposalId, organizationId: input.organizationId },
          include: { approvals: true },
        });
        if (!proposal) throw new PolicyNotFoundError('Proposal not found');
        if (proposal.status !== FinancialProposalStatus.PENDING) {
          throw new PolicyConflictError('Proposal is not pending');
        }
        if (proposal.expiresAt <= input.now) {
          await transaction.financialProposal.update({
            where: { id: proposal.id },
            data: {
              status: FinancialProposalStatus.EXPIRED,
              version: { increment: 1 },
            },
          });
          throw new PolicyConflictError('Proposal expired');
        }
        const membership = await transaction.membership.findFirst({
          where: {
            organizationId: input.organizationId,
            userId: input.approverUserId,
            role: { in: [MembershipRole.OWNER, MembershipRole.APPROVER] },
            revokedAt: null,
          },
          select: { id: true },
        });
        const wallet = await transaction.walletAccount.findFirst({
          where: {
            userId: input.approverUserId,
            network: input.network,
            accountId: input.nearAccountId,
          },
          select: { id: true },
        });
        if (!membership || !wallet) {
          throw new PolicyAuthorizationError(
            'Verified approver wallet required',
          );
        }
        if (proposal.instructionDigest !== input.instructionDigest) {
          throw new PolicyConflictError('Proposal digest changed');
        }
        await transaction.proposalApproval.create({
          data: {
            organizationId: input.organizationId,
            proposalId: proposal.id,
            approverUserId: input.approverUserId,
            approverNearAccountId: input.nearAccountId,
            approvedInstructionDigest: input.instructionDigest,
          },
        });
        await createDecision(transaction, proposal.id, {
          actorUserId: input.approverUserId,
          decision: input.decision,
          proposal: mapProposal(proposal),
        });
        const approvalCount = proposal.approvals.length + 1;
        if (approvalCount >= proposal.approvalThreshold) {
          await transaction.financialProposal.update({
            where: { id: proposal.id },
            data: {
              status: FinancialProposalStatus.APPROVED,
              version: { increment: 1 },
            },
          });
        }
        return mapProposal(
          await transaction.financialProposal.findUniqueOrThrow({
            where: { id: proposal.id },
            include: { approvals: { orderBy: { createdAt: 'asc' } } },
          }),
        );
      });
    } catch (error: unknown) {
      if (knownPrismaError(error, 'P2002')) {
        throw new PolicyConflictError(
          'Approver already approved this revision',
        );
      }
      throw error;
    }
  }

  async contractBinding(organizationId: string) {
    return this.prisma.policyContractBinding.findUnique({
      where: { organizationId },
      select: {
        network: true,
        contractAccountId: true,
        expectedCodeHash: true,
        organizationCommitment: true,
        required: true,
      },
    });
  }

  async eligibleContractApprovers(organizationId: string, network: string) {
    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        revokedAt: null,
        role: { in: [MembershipRole.OWNER, MembershipRole.APPROVER] },
      },
      select: {
        userId: true,
        role: true,
        user: {
          select: {
            walletAccounts: {
              where: { network },
              select: { accountId: true },
            },
          },
        },
      },
    });
    return memberships.flatMap(({ userId, role, user }) =>
      user.walletAccounts.map(({ accountId }) => ({ userId, role, accountId })),
    );
  }

  async bindVerifiedContract(
    input: Parameters<PolicyStore['bindVerifiedContract']>[0],
  ) {
    return this.serializable(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Organization"
        WHERE "id" = ${input.organizationId}::uuid FOR UPDATE
      `;
      const policy = await transaction.policyDefinition.findFirst({
        where: { organizationId: input.organizationId, supersededAt: null },
      });
      if (
        !policy ||
        policy.digest !== input.policyDigest ||
        policy.version !== input.policyVersion ||
        (policy.rules as { approvalThreshold?: number }).approvalThreshold !==
          input.approvalThreshold
      )
        throw new PolicyConflictError('Active policy changed before binding');
      const memberships = await transaction.membership.findMany({
        where: {
          organizationId: input.organizationId,
          revokedAt: null,
          role: { in: [MembershipRole.OWNER, MembershipRole.APPROVER] },
        },
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              walletAccounts: {
                where: {
                  network: input.network,
                  accountId: { in: input.approvers },
                },
                select: { accountId: true },
              },
            },
          },
        },
      });
      const accountOwners = new Map(
        memberships.flatMap(({ userId, user }) =>
          user.walletAccounts.map(
            ({ accountId }) => [accountId, userId] as const,
          ),
        ),
      );
      if (
        input.approvers.length < input.approvalThreshold ||
        !input.approvers.includes(input.controller) ||
        new Set(input.approvers).size !== input.approvers.length ||
        new Set(input.approvers.map((account) => accountOwners.get(account)))
          .size !== input.approvers.length ||
        input.approvers.some((account) => !accountOwners.has(account)) ||
        !memberships.some(
          ({ userId, role, user }) =>
            userId === input.actorUserId &&
            role === MembershipRole.OWNER &&
            user.walletAccounts.some(
              ({ accountId }) => accountId === input.controller,
            ),
        )
      )
        throw new PolicyAuthorizationError(
          'Distinct eligible owner and approvers required',
        );
      const existing = await transaction.policyContractBinding.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (existing) {
        if (
          existing.network !== input.network ||
          existing.contractAccountId !== input.contractAccountId ||
          existing.expectedCodeHash !== input.expectedCodeHash ||
          existing.organizationCommitment !== input.organizationCommitment ||
          !existing.required
        )
          throw new PolicyConflictError(
            'Organization already has a different contract binding',
          );
        return existing;
      }
      const binding = await transaction.policyContractBinding.create({
        data: {
          organizationId: input.organizationId,
          network: input.network,
          contractAccountId: input.contractAccountId,
          expectedCodeHash: input.expectedCodeHash,
          organizationCommitment: input.organizationCommitment,
          required: true,
          verifiedAt: new Date(),
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.actorUserId,
          eventType: 'POLICY_CONTRACT_BOUND',
          entityType: 'POLICY_CONTRACT_BINDING',
          entityId: binding.id,
          correlationId: randomUUID(),
          metadata: {
            network: input.network,
            contractAccountId: input.contractAccountId,
            expectedCodeHash: input.expectedCodeHash,
          },
        },
      });
      return binding;
    });
  }

  async validApprovalUserIds(
    input: Parameters<PolicyStore['validApprovalUserIds']>[0],
  ): Promise<string[]> {
    if (input.approvals.length === 0) return [];
    return this.prisma.$transaction(
      async (transaction) => {
        const userIds = [
          ...new Set(
            input.approvals.map(({ approverUserId }) => approverUserId),
          ),
        ];
        const memberships = await transaction.membership.findMany({
          where: {
            organizationId: input.organizationId,
            userId: { in: userIds },
            role: { in: [MembershipRole.OWNER, MembershipRole.APPROVER] },
            revokedAt: null,
          },
          select: { userId: true },
        });
        const eligible = new Set(memberships.map(({ userId }) => userId));
        const wallets = await transaction.walletAccount.findMany({
          where: {
            network: input.network,
            OR: input.approvals.map(
              ({ approverUserId, approverNearAccountId }) => ({
                userId: approverUserId,
                accountId: approverNearAccountId,
              }),
            ),
          },
          select: { userId: true },
        });
        return [...new Set(wallets.map(({ userId }) => userId))].filter(
          (userId) => eligible.has(userId),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async serializable<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error: unknown) {
        if (!serializationConflict(error) || attempt === 4) throw error;
      }
    }
    throw new Error('Unreachable serializable transaction retry');
  }
}

function proposalData(
  proposal: Omit<ProposalRecord, 'id' | 'createdAt' | 'approvals'>,
): Prisma.FinancialProposalUncheckedCreateInput {
  return {
    ...proposal,
    amountAtomic: new Prisma.Decimal(proposal.amountAtomic),
    authorizedMaxAtomic: new Prisma.Decimal(proposal.authorizedMaxAtomic),
  };
}

async function createDecision(
  transaction: Prisma.TransactionClient,
  proposalId: string,
  input: {
    proposal:
      | Omit<ProposalRecord, 'id' | 'createdAt' | 'approvals'>
      | ProposalRecord;
    decision: Parameters<PolicyStore['createProposal']>[0]['decision'];
    actorUserId: string;
  },
): Promise<void> {
  await transaction.policyDecision.create({
    data: {
      organizationId: input.proposal.organizationId,
      policyDefinitionId: input.proposal.policyDefinitionId,
      proposalId,
      actorUserId: input.actorUserId,
      outcome: input.decision.outcome,
      reasonCodes: json(input.decision.reasonCodes),
      inputsDigest: input.decision.inputsDigest,
      inputSummary: json({
        assetId: input.proposal.assetId,
        chainId: input.proposal.chainId,
        amountAtomic: input.proposal.amountAtomic,
        recipientCommitment: input.proposal.recipientCommitment,
        agentId: input.proposal.agentId,
        vendorId: input.proposal.vendorId,
      }),
    },
  });
}

async function lockProposal(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  proposalId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id" FROM "FinancialProposal"
    WHERE "id" = ${proposalId}::uuid AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
}

async function lockOrganization(
  transaction: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Organization"
    WHERE "id" = ${organizationId}::uuid FOR UPDATE
  `;
  if (rows.length !== 1)
    throw new PolicyNotFoundError('Organization not found');
}

async function assertCurrentPolicy(
  transaction: Prisma.TransactionClient,
  proposal: Pick<
    ProposalRecord,
    'organizationId' | 'policyDefinitionId' | 'policyVersion' | 'policyDigest'
  >,
): Promise<void> {
  const policy = await transaction.policyDefinition.findFirst({
    where: {
      id: proposal.policyDefinitionId,
      organizationId: proposal.organizationId,
      version: proposal.policyVersion,
      digest: proposal.policyDigest,
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!policy)
    throw new PolicyConflictError('Proposal policy changed concurrently');
}

async function assertRollingCapacity(
  transaction: Prisma.TransactionClient,
  input: {
    proposal: Pick<
      ProposalRecord,
      'organizationId' | 'assetId' | 'amountAtomic'
    >;
    rollingWindowStart: Date;
    rollingWindowCapAtomic: string;
  },
  excludedProposalId?: string,
): Promise<void> {
  const result = await transaction.financialProposal.aggregate({
    where: {
      organizationId: input.proposal.organizationId,
      assetId: input.proposal.assetId,
      createdAt: { gte: input.rollingWindowStart },
      status: {
        in: [FinancialProposalStatus.PENDING, FinancialProposalStatus.APPROVED],
      },
      ...(excludedProposalId ? { id: { not: excludedProposalId } } : {}),
    },
    _sum: { amountAtomic: true },
  });
  const committed = BigInt(result._sum.amountAtomic?.toFixed(0) ?? '0');
  if (
    committed + BigInt(input.proposal.amountAtomic) >
    BigInt(input.rollingWindowCapAtomic)
  ) {
    throw new PolicyConflictError('Rolling window cap changed concurrently');
  }
}

function mapPolicy(policy: {
  id: string;
  organizationId: string;
  version: number;
  digest: string;
  rules: Prisma.JsonValue;
}): ActivePolicy {
  return { ...policy, rules: policy.rules as unknown as PolicyRules };
}

function mapProposal(proposal: ProposalWithApprovals): ProposalRecord {
  return {
    ...proposal,
    amountAtomic: proposal.amountAtomic.toFixed(0),
    authorizedMaxAtomic: proposal.authorizedMaxAtomic.toFixed(0),
    agentId: proposal.agentId ?? undefined,
    vendorId: proposal.vendorId ?? undefined,
    approvals: proposal.approvals.map((approval) => ({
      approverUserId: approval.approverUserId,
      approverNearAccountId: approval.approverNearAccountId,
      approvedInstructionDigest: approval.approvedInstructionDigest,
      createdAt: approval.createdAt,
    })),
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function knownPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function serializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' &&
      typeof error.meta === 'object' &&
      error.meta !== null &&
      'code' in error.meta &&
      error.meta.code === '40001')
  );
}
