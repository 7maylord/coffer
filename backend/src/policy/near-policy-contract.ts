import { Inject, Injectable } from '@nestjs/common';
import { JsonRpcProvider } from 'near-api-js';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type { ContractBindingRecord, ProposalRecord } from './policy.types.js';

const base64Digest = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine((value) => {
    try {
      const bytes = Buffer.from(value, 'base64');
      return bytes.byteLength === 32 && bytes.toString('base64') === value;
    } catch {
      return false;
    }
  });
const jsonU64 = z.string().regex(/^(0|[1-9][0-9]*)$/);
const accountId = z.string().min(2).max(64);
export const policyConfigurationSchema = z
  .object({
    state_version: z.literal(1),
    controller: accountId,
    organization_commitment: base64Digest,
    policy_digest: base64Digest,
    configuration_version: jsonU64,
    approval_threshold: z.number().int().min(1).max(16),
    approvers: z.array(accountId).max(32),
    frozen: z.boolean(),
  })
  .strict();
const proposalSchema = z
  .object({
    proposal_id: base64Digest,
    instruction_digest: base64Digest,
    revision: jsonU64,
    policy_version: jsonU64,
    policy_digest: base64Digest,
    expires_at_ns: jsonU64,
    proposer: accountId,
    state: z.enum(['Pending', 'Approved', 'Cancelled', 'Expired']),
    approvals: z.array(accountId).max(32),
    stale_policy: z.boolean(),
    expired: z.boolean(),
  })
  .strict();

export interface FinalViewResult {
  value: unknown;
  blockHash: string;
  blockHeight: number;
}

export interface NearFinalViewClient {
  view(
    contractAccountId: string,
    method: string,
    args: Record<string, unknown>,
    blockHash?: string,
  ): Promise<FinalViewResult>;
  codeHash(contractAccountId: string, blockHash: string): Promise<string>;
  accessKeys(contractAccountId: string, blockHash: string): Promise<number>;
}

export const NEAR_FINAL_VIEW_CLIENT = Symbol('NEAR_FINAL_VIEW_CLIENT');

@Injectable()
export class NearRpcFinalViewClient implements NearFinalViewClient {
  private readonly provider: JsonRpcProvider;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.provider = new JsonRpcProvider({ url: environment.NEAR_RPC_URL });
  }

  async view(
    contractAccountId: string,
    method: string,
    args: Record<string, unknown>,
    blockHash?: string,
  ): Promise<FinalViewResult> {
    const response = await this.provider.callFunctionRaw({
      contractId: contractAccountId,
      method,
      args,
      blockQuery: blockHash ? { blockId: blockHash } : { finality: 'final' },
    });
    return {
      value: JSON.parse(Buffer.from(response.result).toString('utf8')),
      blockHash: response.block_hash,
      blockHeight: response.block_height,
    };
  }

  async codeHash(
    contractAccountId: string,
    blockHash: string,
  ): Promise<string> {
    const result = await this.provider.viewContractCode({
      contractId: contractAccountId,
      blockQuery: { blockId: blockHash },
    });
    return result.hash;
  }

  async accessKeys(
    contractAccountId: string,
    blockHash: string,
  ): Promise<number> {
    const result = await this.provider.query<{ keys: unknown[] }>({
      request_type: 'view_access_key_list',
      account_id: contractAccountId,
      block_id: blockHash,
    });
    if (result.block_hash !== blockHash)
      throw new Error('Access key block mismatch');
    return result.keys.length;
  }
}

export interface ContractVerificationEvidence {
  contractAccountId: string;
  network: string;
  blockHash: string;
  blockHeight: number;
  codeHash: string;
  configurationVersion: string;
  approvalAccounts: string[];
}

@Injectable()
export class NearPolicyContractVerifier {
  constructor(
    @Inject(NEAR_FINAL_VIEW_CLIENT)
    private readonly client: NearFinalViewClient,
  ) {}

  async verify(
    binding: ContractBindingRecord,
    proposal: ProposalRecord,
    now = new Date(),
  ): Promise<ContractVerificationEvidence> {
    try {
      const configurationResult = await this.client.view(
        binding.contractAccountId,
        'get_configuration',
        {},
      );
      const configuration = policyConfigurationSchema.parse(
        configurationResult.value,
      );
      const [codeHash, proposalResult] = await Promise.all([
        this.client.codeHash(
          binding.contractAccountId,
          configurationResult.blockHash,
        ),
        this.client.view(
          binding.contractAccountId,
          'get_proposal',
          { instruction_digest: hexToBase64(proposal.instructionDigest) },
          configurationResult.blockHash,
        ),
      ]);
      const contractProposal = proposalSchema.parse(proposalResult.value);
      requireEqual(
        proposalResult.blockHash,
        configurationResult.blockHash,
        'proposal block hash',
      );
      requireEqual(
        proposalResult.blockHeight,
        configurationResult.blockHeight,
        'proposal block height',
      );
      const expectedApprovals = proposal.approvals
        .map(({ approverNearAccountId }) => approverNearAccountId)
        .sort();
      const contractApprovals = [...contractProposal.approvals].sort();
      requireEqual(codeHash, binding.expectedCodeHash, 'contract code hash');
      requireEqual(
        configuration.organization_commitment,
        hexToBase64(binding.organizationCommitment),
        'organization commitment',
      );
      requireEqual(
        configuration.policy_digest,
        hexToBase64(proposal.policyDigest),
        'configuration policy digest',
      );
      requireEqual(
        configuration.configuration_version,
        String(proposal.policyVersion),
        'configuration version',
      );
      if (configuration.frozen)
        throw new Error('contract configuration frozen');
      if (
        new Set(configuration.approvers).size !== configuration.approvers.length
      ) {
        throw new Error('duplicate configured approver');
      }
      requireEqual(
        configuration.approval_threshold,
        proposal.approvalThreshold,
        'approval threshold',
      );
      requireEqual(
        contractProposal.proposal_id,
        hexToBase64(proposal.proposalIdCommitment),
        'proposal commitment',
      );
      requireEqual(
        contractProposal.instruction_digest,
        hexToBase64(proposal.instructionDigest),
        'instruction digest',
      );
      requireEqual(
        contractProposal.revision,
        String(proposal.revision),
        'revision',
      );
      requireEqual(
        contractProposal.policy_version,
        String(proposal.policyVersion),
        'proposal policy version',
      );
      requireEqual(
        contractProposal.policy_digest,
        hexToBase64(proposal.policyDigest),
        'proposal policy digest',
      );
      requireEqual(contractProposal.state, 'Approved', 'proposal state');
      if (contractProposal.stale_policy || contractProposal.expired) {
        throw new Error('contract proposal is stale or expired');
      }
      if (
        BigInt(contractProposal.expires_at_ns) <=
        BigInt(now.getTime()) * 1_000_000n
      ) {
        throw new Error('contract proposal expired');
      }
      if (
        new Set(contractApprovals).size !== contractApprovals.length ||
        contractApprovals.length < configuration.approval_threshold ||
        contractApprovals.some(
          (approver) => !configuration.approvers.includes(approver),
        ) ||
        JSON.stringify(contractApprovals) !== JSON.stringify(expectedApprovals)
      ) {
        throw new Error('contract approval quorum mismatch');
      }
      return {
        contractAccountId: binding.contractAccountId,
        network: binding.network,
        blockHash: configurationResult.blockHash,
        blockHeight: configurationResult.blockHeight,
        codeHash,
        configurationVersion: configuration.configuration_version,
        approvalAccounts: contractApprovals,
      };
    } catch {
      throw new Error('Policy contract verification failed');
    }
  }

  createProposalCall(proposal: ProposalRecord) {
    return {
      methodName: 'create_proposal' as const,
      args: {
        proposal_id: hexToBase64(proposal.proposalIdCommitment),
        revision: String(proposal.revision),
        instruction_digest: hexToBase64(proposal.instructionDigest),
        policy_version: String(proposal.policyVersion),
        policy_digest: hexToBase64(proposal.policyDigest),
        expires_at_ns: String(
          BigInt(proposal.expiresAt.getTime()) * 1_000_000n,
        ),
      },
    };
  }

  approveProposalCall(proposal: ProposalRecord) {
    return {
      methodName: 'approve_proposal' as const,
      args: { instruction_digest: hexToBase64(proposal.instructionDigest) },
    };
  }
}

function hexToBase64(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid commitment');
  return Buffer.from(value, 'hex').toString('base64');
}

function requireEqual(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) throw new Error(`${field} mismatch`);
}
