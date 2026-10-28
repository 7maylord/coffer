/* oxlint-disable typescript/unbound-method -- client methods are Vitest mocks */
import {
  NearPolicyContractVerifier,
  type NearFinalViewClient,
} from './near-policy-contract.js';
import type { ContractBindingRecord, ProposalRecord } from './policy.types.js';

const hex = (byte: number) => byte.toString(16).padStart(2, '0').repeat(32);
const b64 = (value: string) => Buffer.from(value, 'hex').toString('base64');
const expiresAt = new Date('2026-11-30T00:00:00.000Z');
const proposal: ProposalRecord = {
  id: 'proposal-db-id',
  organizationId: 'org-id',
  proposalKey: '0b8a4475-0bbc-4fba-a1f5-2c6d707dfdd1',
  revision: 1,
  proposalType: 'invoice_payment',
  status: 'APPROVED',
  policyDefinitionId: 'policy-id',
  policyVersion: 3,
  policyDigest: hex(1),
  organizationCommitment: hex(2),
  proposalIdCommitment: hex(3),
  instructionDigest: hex(4),
  chainId: 'near:testnet',
  assetId: 'near:testnet:native',
  amountAtomic: '1',
  authorizedMaxAtomic: '1',
  recipientCommitment: hex(5),
  expiresAt,
  nonceCommitment: hex(6),
  idempotencyKeyCommitment: hex(7),
  operation: 'transfer',
  environment: 'testnet',
  approvalThreshold: 2,
  createdByUserId: 'creator',
  createdAt: new Date('2026-10-30T00:00:00.000Z'),
  approvals: [
    {
      approverUserId: 'user-a',
      approverNearAccountId: 'a.testnet',
      approvedInstructionDigest: hex(4),
      createdAt: new Date(),
    },
    {
      approverUserId: 'user-b',
      approverNearAccountId: 'b.testnet',
      approvedInstructionDigest: hex(4),
      createdAt: new Date(),
    },
  ],
};
const binding: ContractBindingRecord = {
  network: 'testnet',
  contractAccountId: 'policy.testnet',
  expectedCodeHash: 'expected-code-hash',
  organizationCommitment: hex(2),
  required: true,
};

function client(overrides: Record<string, unknown> = {}): NearFinalViewClient {
  return {
    codeHash: vi.fn().mockResolvedValue('expected-code-hash'),
    view: vi.fn().mockImplementation((_account, method, _args, blockHash) => {
      if (method === 'get_configuration') {
        return Promise.resolve({
          value: {
            state_version: 1,
            controller: 'owner.testnet',
            organization_commitment: b64(hex(2)),
            policy_digest: b64(hex(1)),
            configuration_version: '3',
            approval_threshold: 2,
            approvers: ['a.testnet', 'b.testnet'],
            frozen: false,
            ...overrides,
          },
          blockHash: 'final-block',
          blockHeight: 42,
        });
      }
      expect(blockHash).toBe('final-block');
      return Promise.resolve({
        value: {
          proposal_id: b64(hex(3)),
          instruction_digest: b64(hex(4)),
          revision: '1',
          policy_version: '3',
          policy_digest: b64(hex(1)),
          expires_at_ns: String(BigInt(expiresAt.getTime()) * 1_000_000n),
          proposer: 'owner.testnet',
          state: 'Approved',
          approvals: ['b.testnet', 'a.testnet'],
          stale_policy: false,
          expired: false,
        },
        blockHash: 'final-block',
        blockHeight: 42,
      });
    }),
  };
}

describe('NearPolicyContractVerifier', () => {
  it('verifies code, configuration, proposal, expiry, and exact quorum at one final block', async () => {
    const finalClient = client();
    const verifier = new NearPolicyContractVerifier(finalClient);
    await expect(
      verifier.verify(binding, proposal, new Date('2026-10-30T00:00:00.000Z')),
    ).resolves.toEqual({
      contractAccountId: 'policy.testnet',
      network: 'testnet',
      blockHash: 'final-block',
      blockHeight: 42,
      codeHash: 'expected-code-hash',
      configurationVersion: '3',
      approvalAccounts: ['a.testnet', 'b.testnet'],
    });
    expect(finalClient.codeHash).toHaveBeenCalledWith(
      'policy.testnet',
      'final-block',
    );
  });

  it.each([
    { frozen: true },
    { policy_digest: b64(hex(9)) },
    { approval_threshold: 3 },
    { approvers: ['a.testnet', 'a.testnet'] },
  ])(
    'fails closed on malformed or mismatched contract configuration: %o',
    async (override) => {
      await expect(
        new NearPolicyContractVerifier(client(override)).verify(
          binding,
          proposal,
          new Date('2026-10-30T00:00:00.000Z'),
        ),
      ).rejects.toThrow('Policy contract verification failed');
    },
  );

  it('fails closed when final-state RPC is unavailable', async () => {
    const unavailable: NearFinalViewClient = {
      view: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      codeHash: vi.fn(),
    };
    await expect(
      new NearPolicyContractVerifier(unavailable).verify(binding, proposal),
    ).rejects.toThrow('Policy contract verification failed');
  });

  it('rejects a proposal response from a different block', async () => {
    const finalClient = client();
    const originalView = finalClient.view.bind(finalClient);
    finalClient.view = vi.fn(async (account, method, args, blockHash) => {
      const result = await originalView(account, method, args, blockHash);
      return method === 'get_proposal'
        ? { ...result, blockHash: 'other-block' }
        : result;
    });
    await expect(
      new NearPolicyContractVerifier(finalClient).verify(binding, proposal),
    ).rejects.toThrow('Policy contract verification failed');
  });

  it('rejects non-canonical base64 commitments', async () => {
    await expect(
      new NearPolicyContractVerifier(
        client({ organization_commitment: `${b64(hex(2)).slice(0, -1)}!` }),
      ).verify(binding, proposal),
    ).rejects.toThrow('Policy contract verification failed');
  });

  it('builds unsigned, exact-digest contract calls without signing', () => {
    const verifier = new NearPolicyContractVerifier(client());
    expect(verifier.createProposalCall(proposal)).toMatchObject({
      methodName: 'create_proposal',
      args: {
        instruction_digest: b64(hex(4)),
        revision: '1',
        policy_version: '3',
      },
    });
    expect(verifier.approveProposalCall(proposal)).toEqual({
      methodName: 'approve_proposal',
      args: { instruction_digest: b64(hex(4)) },
    });
  });
});
