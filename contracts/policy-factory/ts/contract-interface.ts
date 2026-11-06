export type Base64Digest = string;
export type JsonU64 = string;
export type JsonU128 = string;

export type DeploymentStatus = "Pending" | "Active";

export interface CreatePolicyInstanceArgs {
  organization_commitment: Base64Digest;
  controller: string;
  policy_digest: Base64Digest;
  approvers: string[];
  approval_threshold: number;
}

export interface PolicyInstanceView {
  organization_commitment: Base64Digest;
  account_id: string;
  requested_by: string;
  attached_deposit: JsonU128;
  requested_at_ns: JsonU64;
  status: DeploymentStatus;
}

export interface PolicyFactoryContractInterface {
  create_policy_instance(args: CreatePolicyInstanceArgs): Promise<void>;
  get_policy_code_hash(): Promise<Base64Digest>;
  get_provisioner(): Promise<string>;
  minimum_deployment_deposit(): Promise<JsonU128>;
  get_instance(args: {
    organization_commitment: Base64Digest;
  }): Promise<PolicyInstanceView | null>;
  list_instances(args: {
    from_index?: JsonU64;
    limit?: number;
  }): Promise<PolicyInstanceView[]>;
}
