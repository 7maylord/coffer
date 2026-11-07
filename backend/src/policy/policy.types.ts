export const policyOutcomes = ['ALLOW', 'DENY', 'REQUIRES_APPROVAL'] as const;
export type PolicyOutcome = (typeof policyOutcomes)[number];

export const policyReasonCodes = [
  'POLICY_MISSING',
  'POLICY_UNAVAILABLE',
  'POLICY_EXPIRED',
  'ORGANIZATION_FROZEN',
  'ASSET_NOT_ALLOWED',
  'CHAIN_NOT_ALLOWED',
  'RECIPIENT_NOT_ALLOWED',
  'PER_TRANSACTION_CAP_EXCEEDED',
  'ROLLING_WINDOW_CAP_EXCEEDED',
  'AGENT_NOT_ALLOWED',
  'AGENT_CAP_EXCEEDED',
  'VENDOR_NOT_ALLOWED',
  'VENDOR_CAP_EXCEEDED',
  'APPROVAL_REQUIRED',
] as const;
export type PolicyReasonCode = (typeof policyReasonCodes)[number];

export interface AssetPolicyLimit {
  perTransactionCapAtomic: string;
  rollingWindowCapAtomic: string;
  approvalRequiredAboveAtomic: string;
}

export interface PolicyRules {
  assetLimits: Record<string, AssetPolicyLimit>;
  allowedChainIds: string[];
  allowedRecipientCommitments: string[];
  rollingWindowSeconds: number;
  approvalThreshold: number;
  agentCapsAtomic: Record<string, string>;
  vendorCapsAtomic: Record<string, string>;
  expiresAt: string;
  frozen: boolean;
}

export interface PolicyEvaluationInput {
  organizationId: string;
  actorId: string;
  assetId: string;
  chainId: string;
  recipientCommitment: string;
  amountAtomic: string;
  rollingCommittedAtomic: string;
  agentId?: string;
  vendorId?: string;
}

export interface PolicyEvaluation {
  outcome: PolicyOutcome;
  reasonCodes: PolicyReasonCode[];
  inputsDigest: string;
  policyDigest: string | null;
  policyVersion: number | null;
  approvalThreshold: number | null;
}

export interface ActivePolicy {
  id: string;
  organizationId: string;
  version: number;
  digest: string;
  rules: PolicyRules;
}

export class PolicyValidationError extends Error {}
export class PolicyConflictError extends Error {}
export class PolicyNotFoundError extends Error {}
export class PolicyAuthorizationError extends Error {}

export const POLICY_STORE = Symbol('POLICY_STORE');

export interface ProposalMaterialInput {
  proposalType: string;
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
  agentId?: string;
  vendorId?: string;
}

export interface ProposalRecord extends ProposalMaterialInput {
  id: string;
  organizationId: string;
  proposalKey: string;
  revision: number;
  status:
    | 'PENDING'
    | 'APPROVED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'SUPERSEDED'
    | 'STALE_POLICY';
  policyDefinitionId: string;
  policyVersion: number;
  policyDigest: string;
  organizationCommitment: string;
  proposalIdCommitment: string;
  instructionDigest: string;
  approvalThreshold: number;
  createdByUserId: string;
  createdAt: Date;
  approvals: Array<{
    approverUserId: string;
    approverNearAccountId: string;
    approvedInstructionDigest: string;
    createdAt: Date;
  }>;
}

export interface ContractBindingRecord {
  network: string;
  contractAccountId: string;
  expectedCodeHash: string;
  organizationCommitment: string;
  required: boolean;
}

export interface PolicyStore {
  activatePolicy(input: {
    organizationId: string;
    actorUserId: string;
    digest: string;
    rules: PolicyRules;
    now: Date;
  }): Promise<ActivePolicy>;
  activePolicy(organizationId: string): Promise<ActivePolicy | null>;
  rollingCommitted(input: {
    organizationId: string;
    assetId: string;
    since: Date;
  }): Promise<string>;
  recordDecision(input: {
    organizationId: string;
    policyDefinitionId?: string;
    actorUserId: string;
    decision: PolicyEvaluation;
    inputSummary: Record<string, unknown>;
  }): Promise<void>;
  createProposal(input: {
    proposal: Omit<ProposalRecord, 'id' | 'createdAt' | 'approvals'>;
    decision: PolicyEvaluation;
    actorUserId: string;
    rollingWindowStart: Date;
    rollingWindowCapAtomic: string;
  }): Promise<ProposalRecord>;
  reviseProposal(input: {
    previousId: string;
    proposal: Omit<ProposalRecord, 'id' | 'createdAt' | 'approvals'>;
    decision: PolicyEvaluation;
    actorUserId: string;
    rollingWindowStart: Date;
    rollingWindowCapAtomic: string;
  }): Promise<ProposalRecord>;
  proposal(
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalRecord | null>;
  proposals(organizationId: string): Promise<ProposalRecord[]>;
  cancelProposal(input: {
    organizationId: string;
    proposalId: string;
  }): Promise<ProposalRecord>;
  addApproval(input: {
    organizationId: string;
    proposalId: string;
    approverUserId: string;
    nearAccountId: string;
    network: string;
    instructionDigest: string;
    now: Date;
    decision: PolicyEvaluation;
  }): Promise<ProposalRecord>;
  contractBinding(
    organizationId: string,
  ): Promise<ContractBindingRecord | null>;
  eligibleContractApprovers(
    organizationId: string,
    network: string,
  ): Promise<Array<{ userId: string; role: string; accountId: string }>>;
  bindVerifiedContract(input: {
    organizationId: string;
    actorUserId: string;
    network: string;
    contractAccountId: string;
    expectedCodeHash: string;
    organizationCommitment: string;
    policyDigest: string;
    policyVersion: number;
    approvalThreshold: number;
    controller: string;
    approvers: string[];
  }): Promise<ContractBindingRecord>;
  validApprovalUserIds(input: {
    organizationId: string;
    network: string;
    approvals: ProposalRecord['approvals'];
  }): Promise<string[]>;
  onModuleDestroy?(): Promise<void>;
}
