// oxlint-disable typescript/unbound-method -- Vitest store methods are mock functions.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parseEnvironment } from '../config/env.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import {
  NearPolicyContractVerifier,
  type NearFinalViewClient,
} from './near-policy-contract.js';
import { DeterministicPolicyEngine } from './policy-engine.js';
import { PolicyService } from './policy.service.js';
import type {
  ActivePolicy,
  PolicyRules,
  PolicyStore,
  ProposalRecord,
} from './policy.types.js';

const recipient = 'a'.repeat(64);
const now = new Date('2026-10-30T00:00:00.000Z');
const rules: PolicyRules = {
  assetLimits: {
    'mock:near:usdc': {
      perTransactionCapAtomic: '1000',
      rollingWindowCapAtomic: '2000',
      approvalRequiredAboveAtomic: '100',
    },
  },
  allowedChainIds: ['near:testnet'],
  allowedRecipientCommitments: [recipient],
  rollingWindowSeconds: 86_400,
  approvalThreshold: 2,
  agentCapsAtomic: {},
  vendorCapsAtomic: {},
  expiresAt: '2099-01-01T00:00:00.000Z',
  frozen: false,
};
const engine = new DeterministicPolicyEngine();
const normalized = engine.normalizeRules(rules);
const policy: ActivePolicy = {
  id: 'policy-id',
  organizationId: 'org-id',
  version: 1,
  digest: engine.policyDigest(normalized),
  rules: normalized,
};
const material = {
  proposalType: 'invoice_payment',
  chainId: 'near:testnet',
  assetId: 'mock:near:usdc',
  amountAtomic: '101',
  authorizedMaxAtomic: '101',
  recipientCommitment: recipient,
  expiresAt: new Date('2026-11-01T00:00:00.000Z'),
  nonceCommitment: 'b'.repeat(64),
  idempotencyKeyCommitment: 'c'.repeat(64),
  operation: 'transfer',
  environment: 'testnet',
};
const principal: SessionPrincipal = {
  sessionId: 'session-id',
  userId: 'approver-id',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  wallets: [{ network: 'testnet', accountId: 'approver.testnet' }],
  memberships: [{ organizationId: 'org-id', role: 'APPROVER' }],
};

describe('PolicyService', () => {
  let records: ProposalRecord[];
  let store: PolicyStore;
  let service: PolicyService;
  let verify: ReturnType<typeof vi.fn<NearPolicyContractVerifier['verify']>>;

  beforeEach(() => {
    records = [];
    store = {
      activatePolicy: vi.fn().mockImplementation((input) =>
        Promise.resolve({
          ...policy,
          digest: input.digest,
          rules: input.rules,
        }),
      ),
      activePolicy: vi.fn().mockResolvedValue(policy),
      rollingCommitted: vi.fn().mockResolvedValue('0'),
      recordDecision: vi.fn().mockResolvedValue(undefined),
      createProposal: vi.fn().mockImplementation(({ proposal }) => {
        const record = {
          ...proposal,
          id: 'proposal-id',
          createdAt: now,
          approvals: [],
        } as ProposalRecord;
        records.push(record);
        return Promise.resolve(record);
      }),
      reviseProposal: vi.fn().mockImplementation(({ proposal }) => {
        const record = {
          ...proposal,
          id: 'proposal-revision-id',
          createdAt: now,
          approvals: [],
        } as ProposalRecord;
        records.push(record);
        return Promise.resolve(record);
      }),
      proposal: vi
        .fn()
        .mockImplementation((_organizationId, proposalId) =>
          Promise.resolve(records.find(({ id }) => id === proposalId) ?? null),
        ),
      proposals: vi.fn().mockImplementation(() => Promise.resolve(records)),
      cancelProposal: vi.fn().mockImplementation(({ proposalId }) => {
        const record = records.find(({ id }) => id === proposalId)!;
        return Promise.resolve({ ...record, status: 'CANCELLED' });
      }),
      addApproval: vi.fn().mockImplementation(({ proposalId }) => {
        const record = records.find(({ id }) => id === proposalId)!;
        return Promise.resolve({
          ...record,
          status: 'APPROVED',
          approvals: [
            ...record.approvals,
            {
              approverUserId: principal.userId,
              approverNearAccountId: 'approver.testnet',
              approvedInstructionDigest: record.instructionDigest,
              createdAt: now,
            },
          ],
        });
      }),
      contractBinding: vi.fn().mockResolvedValue(null),
      eligibleContractApprovers: vi.fn().mockResolvedValue([]),
      bindVerifiedContract: vi.fn(),
      validApprovalUserIds: vi
        .fn()
        .mockImplementation(({ approvals }) =>
          Promise.resolve(
            approvals.map(
              ({ approverUserId }: { approverUserId: string }) =>
                approverUserId,
            ),
          ),
        ),
    };
    verify = vi.fn<NearPolicyContractVerifier['verify']>();
    const verifier = new NearPolicyContractVerifier({
      view: vi.fn(),
      codeHash: vi.fn(),
      accessKeys: vi.fn(),
    } as NearFinalViewClient);
    verifier.verify = verify;
    service = new PolicyService(store, engine, verifier, parseEnvironment());
  });

  it('normalizes and activates policies while rejecting invalid rule documents', async () => {
    await expect(
      service.activate('owner-id', 'org-id', rules, now),
    ).resolves.toMatchObject({
      version: 1,
      digest: policy.digest,
    });
    await expect(
      service.activate('owner-id', 'org-id', {}, now),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates and revises immutable proposal digests under the active policy', async () => {
    const created = await service.create('owner-id', 'org-id', material, now);
    expect(created.instructionDigest).toMatch(/^[0-9a-f]{64}$/);
    const revised = await service.revise(
      'owner-id',
      'org-id',
      created.id,
      { ...material, amountAtomic: '102', authorizedMaxAtomic: '102' },
      now,
    );
    expect(revised).toMatchObject({
      proposalKey: created.proposalKey,
      revision: 2,
      approvals: [],
    });
    expect(revised.instructionDigest).not.toBe(created.instructionDigest);
  });

  it('records and rejects missing-policy and hard-deny decisions', async () => {
    vi.mocked(store.activePolicy).mockResolvedValueOnce(null);
    await expect(
      service.create('owner-id', 'org-id', material, now),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        policyDefinitionId: undefined,
        decision: expect.objectContaining({ reasonCodes: ['POLICY_MISSING'] }),
      }),
    );
    await expect(
      service.create(
        'owner-id',
        'org-id',
        { ...material, amountAtomic: '1001', authorizedMaxAtomic: '1001' },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects invalid bounds, absent proposals, unverified wallets, and stale policy', async () => {
    await expect(
      service.create(
        'owner-id',
        'org-id',
        { ...material, authorizedMaxAtomic: '100' },
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.get('org-id', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const created = await service.create('owner-id', 'org-id', material, now);
    await expect(
      service.approve(
        { ...principal, wallets: [] },
        'org-id',
        created.id,
        'approver.testnet',
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    vi.mocked(store.activePolicy).mockResolvedValueOnce({
      ...policy,
      version: 2,
    });
    await expect(
      service.approve(principal, 'org-id', created.id, 'approver.testnet', now),
    ).rejects.toThrow('stale');
  });

  it('re-evaluates policy before recording a verified-wallet approval', async () => {
    const created = await service.create('owner-id', 'org-id', material, now);
    await expect(
      service.approve(principal, 'org-id', created.id, 'approver.testnet', now),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    expect(store.addApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        instructionDigest: created.instructionDigest,
        decision: expect.objectContaining({ outcome: 'REQUIRES_APPROVAL' }),
      }),
    );
  });

  it('revalidates status, digest, policy, quorum, and optional contract state before execution', async () => {
    const created = await service.create('owner-id', 'org-id', material, now);
    records[0] = {
      ...created,
      status: 'APPROVED',
      approvals: [
        approval('user-a', 'a.testnet', created.instructionDigest),
        approval('user-b', 'b.testnet', created.instructionDigest),
      ],
    };
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).resolves.toEqual({
      executable: true,
      verification: 'offchain',
    });
    vi.mocked(store.contractBinding).mockResolvedValueOnce({
      network: 'testnet',
      contractAccountId: 'policy.testnet',
      expectedCodeHash: 'code-hash',
      organizationCommitment: created.organizationCommitment,
      required: true,
    });
    verify.mockResolvedValueOnce({
      contractAccountId: 'policy.testnet',
      network: 'testnet',
      blockHash: 'final',
      blockHeight: 42,
      codeHash: 'code-hash',
      configurationVersion: '1',
      approvalAccounts: ['a.testnet', 'b.testnet'],
    });
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).resolves.toMatchObject({
      verification: 'contract',
      evidence: { blockHash: 'final' },
    });
  });

  it('T-PAY-03 fails closed on changed amount, invalid quorum, digest, and required RPC verification', async () => {
    const created = await service.create('owner-id', 'org-id', material, now);
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).rejects.toThrow('not executable');
    records[0] = {
      ...created,
      status: 'APPROVED',
      approvals: [approval('user-a', 'a.testnet', created.instructionDigest)],
    };
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).rejects.toThrow('quorum');
    records[0] = {
      ...created,
      status: 'APPROVED',
      amountAtomic: '102',
      approvals: [
        approval('user-a', 'a.testnet', created.instructionDigest),
        approval('user-b', 'b.testnet', created.instructionDigest),
      ],
    };
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).rejects.toThrow('digest');
    records[0] = {
      ...records[0],
      approvals: [
        approval('user-a', 'a.testnet', 'f'.repeat(64)),
        approval('user-b', 'b.testnet', 'f'.repeat(64)),
      ],
      instructionDigest: 'f'.repeat(64),
    };
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).rejects.toThrow('digest');
    records[0] = {
      ...created,
      status: 'APPROVED',
      approvals: [
        approval('user-a', 'a.testnet', created.instructionDigest),
        approval('user-b', 'b.testnet', created.instructionDigest),
      ],
    };
    vi.mocked(store.contractBinding).mockResolvedValueOnce({
      network: 'testnet',
      contractAccountId: 'policy.testnet',
      expectedCodeHash: 'code-hash',
      organizationCommitment: created.organizationCommitment,
      required: true,
    });
    verify.mockRejectedValueOnce(new Error('rpc timeout'));
    await expect(
      service.verifyForExecution('org-id', created.id, now),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function approval(userId: string, accountId: string, digest: string) {
  return {
    approverUserId: userId,
    approverNearAccountId: accountId,
    approvedInstructionDigest: digest,
    createdAt: now,
  };
}
