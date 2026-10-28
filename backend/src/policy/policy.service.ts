import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { parseAtomicAmount } from '../treasury/money.js';
import { NearPolicyContractVerifier } from './near-policy-contract.js';
import { DeterministicPolicyEngine } from './policy-engine.js';
import {
  POLICY_STORE,
  type ActivePolicy,
  type PolicyEvaluation,
  type PolicyRules,
  type PolicyStore,
  type ProposalMaterialInput,
  type ProposalRecord,
  PolicyConflictError,
  PolicyNotFoundError,
  PolicyAuthorizationError,
  PolicyValidationError,
} from './policy.types.js';
import {
  canonicalProposalDigest,
  commitment,
  hex32,
} from './proposal-digest.js';

@Injectable()
export class PolicyService {
  constructor(
    @Inject(POLICY_STORE) private readonly store: PolicyStore,
    @Inject(DeterministicPolicyEngine)
    private readonly engine: DeterministicPolicyEngine,
    @Inject(NearPolicyContractVerifier)
    private readonly contractVerifier: NearPolicyContractVerifier,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async activate(
    actorUserId: string,
    organizationId: string,
    value: unknown,
    now = new Date(),
  ) {
    let rules: PolicyRules;
    try {
      rules = this.engine.normalizeRules(value);
    } catch (error) {
      if (error instanceof PolicyValidationError) {
        throw new BadRequestException('Invalid policy rules');
      }
      throw error;
    }
    try {
      return await this.store.activatePolicy({
        organizationId,
        actorUserId,
        digest: this.engine.policyDigest(rules),
        rules,
        now,
      });
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async active(organizationId: string) {
    const policy = await this.store.activePolicy(organizationId);
    if (!policy) throw new NotFoundException();
    return policy;
  }

  async create(
    actorUserId: string,
    organizationId: string,
    material: ProposalMaterialInput,
    now = new Date(),
  ): Promise<ProposalRecord> {
    return this.createRevision({
      actorUserId,
      organizationId,
      material,
      now,
      proposalKey: randomUUID(),
      revision: 1,
    });
  }

  async revise(
    actorUserId: string,
    organizationId: string,
    proposalId: string,
    material: ProposalMaterialInput,
    now = new Date(),
  ): Promise<ProposalRecord> {
    const previous = await this.requireProposal(organizationId, proposalId);
    return this.createRevision({
      actorUserId,
      organizationId,
      material,
      now,
      proposalKey: previous.proposalKey,
      revision: previous.revision + 1,
      previous,
    });
  }

  async get(organizationId: string, proposalId: string) {
    return this.requireProposal(organizationId, proposalId);
  }

  list(organizationId: string) {
    return this.store.proposals(organizationId);
  }

  async activeOrNull(organizationId: string) {
    return this.store.activePolicy(organizationId);
  }

  async cancel(organizationId: string, proposalId: string) {
    try {
      return await this.store.cancelProposal({ organizationId, proposalId });
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async approve(
    principal: SessionPrincipal,
    organizationId: string,
    proposalId: string,
    nearAccountId: string,
    now = new Date(),
  ): Promise<ProposalRecord> {
    if (
      !principal.wallets.some(
        (wallet) =>
          wallet.network === this.environment.NEAR_NETWORK &&
          wallet.accountId === nearAccountId,
      )
    ) {
      throw new ForbiddenException('Verified session wallet required');
    }
    const proposal = await this.requireProposal(organizationId, proposalId);
    const policy = await this.trustedActivePolicy(organizationId);
    if (
      !policy ||
      policy.id !== proposal.policyDefinitionId ||
      policy.version !== proposal.policyVersion ||
      policy.digest !== proposal.policyDigest
    ) {
      throw new ConflictException('Proposal policy is stale');
    }
    const decision = await this.evaluate(
      policy,
      organizationId,
      principal.userId,
      proposal,
      now,
      proposal,
    );
    if (decision.outcome === 'DENY') {
      await this.store.recordDecision({
        organizationId,
        policyDefinitionId: policy.id,
        actorUserId: principal.userId,
        decision,
        inputSummary: summary(proposal),
      });
      throw new ForbiddenException(decision.reasonCodes.join(','));
    }
    try {
      return await this.store.addApproval({
        organizationId,
        proposalId,
        approverUserId: principal.userId,
        nearAccountId,
        network: this.environment.NEAR_NETWORK,
        instructionDigest: proposal.instructionDigest,
        now,
        decision,
      });
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async verifyForExecution(
    organizationId: string,
    proposalId: string,
    now = new Date(),
  ) {
    const proposal = await this.requireProposal(organizationId, proposalId);
    if (proposal.status !== 'APPROVED' || proposal.expiresAt <= now) {
      throw new ConflictException('Proposal is not executable');
    }
    const policy = await this.trustedActivePolicy(organizationId);
    if (
      !policy ||
      policy.id !== proposal.policyDefinitionId ||
      policy.digest !== proposal.policyDigest ||
      policy.version !== proposal.policyVersion
    ) {
      throw new ConflictException('Proposal policy is stale');
    }
    if (
      new Set(proposal.approvals.map(({ approverUserId }) => approverUserId))
        .size < proposal.approvalThreshold ||
      proposal.approvals.some(
        ({ approvedInstructionDigest }) =>
          approvedInstructionDigest !== proposal.instructionDigest,
      )
    ) {
      throw new ConflictException('Approval quorum is invalid');
    }
    const recomputed = digestProposal(proposal);
    if (recomputed !== proposal.instructionDigest) {
      throw new ConflictException('Proposal digest is invalid');
    }
    const decision = await this.evaluate(
      policy,
      organizationId,
      proposal.createdByUserId,
      proposal,
      now,
      proposal,
    );
    if (decision.outcome === 'DENY') {
      throw new ForbiddenException(decision.reasonCodes.join(','));
    }
    const binding = await this.store.contractBinding(organizationId);
    const validApprovers = await this.store.validApprovalUserIds({
      organizationId,
      network: this.environment.NEAR_NETWORK,
      approvals: proposal.approvals,
    });
    if (new Set(validApprovers).size < proposal.approvalThreshold) {
      throw new ConflictException('Approval quorum is no longer authorized');
    }
    if (!binding) {
      return { executable: true, verification: 'offchain' as const };
    }
    if (binding.network !== this.environment.NEAR_NETWORK) {
      throw new ServiceUnavailableException('Policy contract network mismatch');
    }
    try {
      const evidence = await this.contractVerifier.verify(
        binding,
        proposal,
        now,
      );
      return { executable: true, verification: 'contract' as const, evidence };
    } catch {
      throw new ServiceUnavailableException(
        binding.required
          ? 'Required policy contract could not be verified'
          : 'Policy contract could not be verified',
      );
    }
  }

  private async createRevision(input: {
    actorUserId: string;
    organizationId: string;
    material: ProposalMaterialInput;
    now: Date;
    proposalKey: string;
    revision: number;
    previous?: ProposalRecord;
  }): Promise<ProposalRecord> {
    validateMaterial(input.material, input.now);
    const policy = await this.trustedActivePolicy(input.organizationId);
    const decision = await this.evaluate(
      policy,
      input.organizationId,
      input.actorUserId,
      input.material,
      input.now,
      input.previous,
    );
    if (!policy || decision.outcome === 'DENY') {
      await this.store.recordDecision({
        organizationId: input.organizationId,
        policyDefinitionId: policy?.id,
        actorUserId: input.actorUserId,
        decision,
        inputSummary: summary(input.material),
      });
      throw new ForbiddenException(decision.reasonCodes.join(','));
    }
    const proposalBase = {
      organizationId: input.organizationId,
      proposalKey: input.proposalKey,
      revision: input.revision,
      status: 'PENDING' as const,
      policyDefinitionId: policy.id,
      policyVersion: policy.version,
      policyDigest: policy.digest,
      organizationCommitment: commitment(
        'coffer:organization:v1',
        input.organizationId,
      ).toString('hex'),
      proposalIdCommitment: commitment(
        'coffer:proposal-id:v1',
        input.proposalKey,
      ).toString('hex'),
      approvalThreshold: policy.rules.approvalThreshold,
      createdByUserId: input.actorUserId,
      ...input.material,
    };
    const proposal = {
      ...proposalBase,
      instructionDigest: digestProposal(proposalBase),
    };
    const limit = policy.rules.assetLimits[input.material.assetId];
    if (!limit) throw new ForbiddenException('ASSET_NOT_ALLOWED');
    const rollingGuard = {
      rollingWindowStart: new Date(
        input.now.getTime() - policy.rules.rollingWindowSeconds * 1_000,
      ),
      rollingWindowCapAtomic: limit.rollingWindowCapAtomic,
    };
    try {
      return input.previous
        ? await this.store.reviseProposal({
            previousId: input.previous.id,
            proposal,
            decision,
            actorUserId: input.actorUserId,
            ...rollingGuard,
          })
        : await this.store.createProposal({
            proposal,
            decision,
            actorUserId: input.actorUserId,
            ...rollingGuard,
          });
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  private async evaluate(
    policy: ActivePolicy | null,
    organizationId: string,
    actorId: string,
    material: ProposalMaterialInput,
    now: Date,
    excluded?: ProposalRecord,
  ): Promise<PolicyEvaluation> {
    let committed = policy
      ? BigInt(
          await this.store.rollingCommitted({
            organizationId,
            assetId: material.assetId,
            since: new Date(
              now.getTime() - policy.rules.rollingWindowSeconds * 1_000,
            ),
          }),
        )
      : 0n;
    if (
      excluded &&
      ['PENDING', 'APPROVED'].includes(excluded.status) &&
      excluded.assetId === material.assetId
    ) {
      committed =
        committed > BigInt(excluded.amountAtomic)
          ? committed - BigInt(excluded.amountAtomic)
          : 0n;
    }
    return this.engine.evaluateFailClosed(
      policy,
      {
        organizationId,
        actorId,
        assetId: material.assetId,
        chainId: material.chainId,
        recipientCommitment: material.recipientCommitment,
        amountAtomic: material.amountAtomic,
        rollingCommittedAtomic: committed.toString(),
        agentId: material.agentId,
        vendorId: material.vendorId,
      },
      now,
    );
  }

  private async trustedActivePolicy(
    organizationId: string,
  ): Promise<ActivePolicy | null> {
    const policy = await this.store.activePolicy(organizationId);
    if (!policy) return null;
    try {
      const rules = this.engine.normalizeRules(policy.rules);
      if (this.engine.policyDigest(rules) !== policy.digest) return null;
      return { ...policy, rules };
    } catch {
      return null;
    }
  }

  private async requireProposal(
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalRecord> {
    const proposal = await this.store.proposal(organizationId, proposalId);
    if (!proposal) throw new NotFoundException();
    return proposal;
  }
}

function digestProposal(proposal: {
  organizationCommitment: string;
  proposalType: string;
  proposalIdCommitment: string;
  revision: number;
  policyVersion: number;
  policyDigest: string;
  chainId: string;
  assetId: string;
  amountAtomic: string;
  authorizedMaxAtomic: string;
  recipientCommitment: string;
  expiresAt: Date;
  nonceCommitment: string;
  idempotencyKeyCommitment: string;
  operation: string;
  environment: string;
}): string {
  return canonicalProposalDigest({
    organizationCommitment: hex32(
      proposal.organizationCommitment,
      'organizationCommitment',
    ),
    proposalType: proposal.proposalType,
    proposalId: hex32(proposal.proposalIdCommitment, 'proposalIdCommitment'),
    revision: BigInt(proposal.revision),
    policyVersion: BigInt(proposal.policyVersion),
    policyDigest: hex32(proposal.policyDigest, 'policyDigest'),
    chainId: proposal.chainId,
    assetId: proposal.assetId,
    amountAtomic: BigInt(proposal.amountAtomic),
    authorizedMaxAtomic: BigInt(proposal.authorizedMaxAtomic),
    recipientCommitment: hex32(
      proposal.recipientCommitment,
      'recipientCommitment',
    ),
    expiresAtNs: BigInt(proposal.expiresAt.getTime()) * 1_000_000n,
    nonce: hex32(proposal.nonceCommitment, 'nonceCommitment'),
    idempotencyKeyCommitment: hex32(
      proposal.idempotencyKeyCommitment,
      'idempotencyKeyCommitment',
    ),
    operation: proposal.operation,
    environment: proposal.environment,
  }).toString('hex');
}

function validateMaterial(material: ProposalMaterialInput, now: Date): void {
  const amount = parseAtomicAmount(material.amountAtomic);
  const maximum = parseAtomicAmount(material.authorizedMaxAtomic);
  if (maximum < amount || material.expiresAt <= now) {
    throw new ConflictException('Invalid proposal bounds');
  }
}

function summary(material: ProposalMaterialInput): Record<string, unknown> {
  return {
    assetId: material.assetId,
    chainId: material.chainId,
    amountAtomic: material.amountAtomic,
    recipientCommitment: material.recipientCommitment,
    agentId: material.agentId,
    vendorId: material.vendorId,
  };
}

function mapStoreError(error: unknown): Error {
  if (error instanceof PolicyNotFoundError) return new NotFoundException();
  if (error instanceof PolicyAuthorizationError)
    return new ForbiddenException();
  if (error instanceof PolicyConflictError) {
    return new ConflictException(error.message);
  }
  return error instanceof Error ? error : new Error('Policy operation failed');
}
