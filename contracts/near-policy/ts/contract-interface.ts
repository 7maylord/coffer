export type Base64Digest = string;
export type JsonU64 = string;

export type ProposalState = "Pending" | "Approved" | "Cancelled" | "Expired";
export type ConfigurationChangeState = "Pending" | "Applied" | "Cancelled";

export interface OrganizationConfigView {
  state_version: number;
  controller: string;
  organization_commitment: Base64Digest;
  policy_digest: Base64Digest;
  configuration_version: JsonU64;
  approval_threshold: number;
  approvers: string[];
  frozen: boolean;
}

export interface ConfigurationChangeView {
  digest: Base64Digest;
  proposer: string;
  base_version: JsonU64;
  policy_digest: Base64Digest;
  approval_threshold: number;
  approvers: string[];
  frozen: boolean;
  approvals: string[];
  state: ConfigurationChangeState;
}

export interface ProposalView {
  proposal_id: Base64Digest;
  instruction_digest: Base64Digest;
  revision: JsonU64;
  policy_version: JsonU64;
  policy_digest: Base64Digest;
  expires_at_ns: JsonU64;
  proposer: string;
  state: ProposalState;
  approvals: string[];
  stale_policy: boolean;
  expired: boolean;
}

export interface CreateProposalArgs {
  proposal_id: Base64Digest;
  revision: JsonU64;
  instruction_digest: Base64Digest;
  policy_version: JsonU64;
  policy_digest: Base64Digest;
  expires_at_ns: JsonU64;
}

export interface ProposeConfigurationArgs {
  policy_digest: Base64Digest;
  approvers: string[];
  approval_threshold: number;
  frozen: boolean;
}

export interface NearPolicyContractInterface {
  get_configuration(): Promise<OrganizationConfigView>;
  get_pending_configuration(): Promise<ConfigurationChangeView | null>;
  get_configuration_change(args: {
    digest: Base64Digest;
  }): Promise<ConfigurationChangeView | null>;
  list_configuration_changes(args: {
    from_index?: JsonU64;
    limit?: number;
  }): Promise<ConfigurationChangeView[]>;
  get_proposal(args: {
    instruction_digest: Base64Digest;
  }): Promise<ProposalView | null>;
  list_proposals(args: {
    from_index?: JsonU64;
    limit?: number;
  }): Promise<ProposalView[]>;
  propose_configuration(args: ProposeConfigurationArgs): Promise<Base64Digest>;
  approve_configuration(args: { digest: Base64Digest }): Promise<boolean>;
  cancel_configuration(args: { digest: Base64Digest }): Promise<void>;
  create_proposal(args: CreateProposalArgs): Promise<Base64Digest>;
  approve_proposal(args: {
    instruction_digest: Base64Digest;
  }): Promise<boolean>;
  cancel_proposal(args: { instruction_digest: Base64Digest }): Promise<void>;
  expire_proposal(args: { instruction_digest: Base64Digest }): Promise<void>;
}
