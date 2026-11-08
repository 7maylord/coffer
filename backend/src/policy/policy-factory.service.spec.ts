/* oxlint-disable typescript/unbound-method -- Vitest store/client methods are mocks. */
import { baseDecode } from 'near-api-js';
import { parseEnvironment } from '../config/env.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { DeterministicPolicyEngine } from './policy-engine.js';
import { PolicyFactoryService } from './policy-factory.service.js';
import { commitment } from './proposal-digest.js';
import type { NearFinalViewClient } from './near-policy-contract.js';
import type { PolicyStore, PolicyRules } from './policy.types.js';

const factoryId = 'factory.olymight.testnet';
const provisionerId = 'olymight.testnet';
const factoryHash = 'DpSNraj7RMxNiJiTY7zPA3NfoC9Qx3MWgiERgBG5gM5A';
const policyHash = 'EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj';
const organizationId = 'a56d5973-e9ad-4a53-98d8-10a919842915';
const organizationCommitment = commitment(
  'coffer:organization:v1',
  organizationId,
);
const instanceId = `${organizationCommitment.subarray(0, 16).toString('hex')}.${factoryId}`;
const engine = new DeterministicPolicyEngine();
const rules: PolicyRules = {
  assetLimits: {
    'mock:near:usdc': {
      perTransactionCapAtomic: '1000',
      rollingWindowCapAtomic: '2000',
      approvalRequiredAboveAtomic: '100',
    },
  },
  allowedChainIds: ['near:testnet'],
  allowedRecipientCommitments: ['a'.repeat(64)],
  rollingWindowSeconds: 86_400,
  approvalThreshold: 2,
  agentCapsAtomic: {},
  vendorCapsAtomic: {},
  expiresAt: '2099-01-01T00:00:00.000Z',
  frozen: false,
};
const policyDigest = engine.policyDigest(engine.normalizeRules(rules));
const principal: SessionPrincipal = {
  sessionId: 'session',
  userId: 'owner-user',
  expiresAt: new Date('2099-01-01'),
  wallets: [{ network: 'testnet', accountId: 'owner.testnet' }],
  memberships: [{ organizationId, role: 'OWNER' }],
};

function fixture(overrides: Record<string, unknown> = {}) {
  const store = {
    activePolicy: vi.fn().mockResolvedValue({
      id: 'policy-id',
      organizationId,
      digest: policyDigest,
      version: 1,
      rules,
    }),
    eligibleContractApprovers: vi.fn().mockResolvedValue([
      { userId: 'owner-user', role: 'OWNER', accountId: 'owner.testnet' },
      {
        userId: 'approver-user',
        role: 'APPROVER',
        accountId: 'approver.testnet',
      },
    ]),
    bindVerifiedContract: vi
      .fn()
      .mockResolvedValue({ contractAccountId: instanceId, required: true }),
    contractBinding: vi.fn().mockResolvedValue(null),
  } as unknown as PolicyStore;
  const values: Record<string, unknown> = {
    get_policy_code_hash: Buffer.from(baseDecode(policyHash)).toString(
      'base64',
    ),
    get_provisioner: provisionerId,
    minimum_deployment_deposit: '250000000000000000000000',
    get_instance: {
      organization_commitment: organizationCommitment.toString('base64'),
      account_id: instanceId,
      requested_by: provisionerId,
      status: 'Active',
    },
    get_configuration: {
      state_version: 1,
      controller: 'owner.testnet',
      organization_commitment: organizationCommitment.toString('base64'),
      policy_digest: Buffer.from(policyDigest, 'hex').toString('base64'),
      configuration_version: '1',
      approval_threshold: 2,
      approvers: ['approver.testnet', 'owner.testnet'],
      frozen: false,
    },
    ...overrides,
  };
  const client = {
    view: vi
      .fn()
      .mockImplementation(
        (_account: string, method: string, _args: unknown, block?: string) =>
          Promise.resolve({
            value: values[method],
            blockHash: block ?? 'final-block',
            blockHeight: 1,
          }),
      ),
    codeHash: vi
      .fn()
      .mockImplementation((account: string) =>
        Promise.resolve(account === factoryId ? factoryHash : policyHash),
      ),
    accessKeys: vi.fn().mockResolvedValue(0),
  } as unknown as NearFinalViewClient;
  const environment = parseEnvironment({
    NEAR_POLICY_FACTORY_ACCOUNT_ID: factoryId,
    NEAR_POLICY_FACTORY_CODE_HASH: factoryHash,
    NEAR_POLICY_PROVISIONER_ACCOUNT_ID: provisionerId,
    NEAR_POLICY_CODE_HASH: policyHash,
  });
  return {
    service: new PolicyFactoryService(store, client, engine, environment),
    store,
    client,
  };
}

describe('PolicyFactoryService', () => {
  it('prepares a provisioner call only for a verified owner wallet', async () => {
    const { service, store } = fixture();
    await expect(
      service.prepare(principal, organizationId),
    ).resolves.toMatchObject({
      deploymentStatus: 'ACTIVE',
      binding: null,
      factoryAccountId: factoryId,
      provisionerAccountId: provisionerId,
      methodName: 'create_policy_instance',
      expectedInstanceAccountId: instanceId,
      approvalThreshold: 2,
      minimumDepositYocto: '250000000000000000000000',
    });
    await expect(
      service.prepare({ ...principal, wallets: [] }, organizationId),
    ).rejects.toThrow('Verified owner wallet required');
    expect(store.bindVerifiedContract).not.toHaveBeenCalled();
  });

  it.each([
    [null, null, 'READY'],
    [
      {
        organization_commitment: organizationCommitment.toString('base64'),
        account_id: instanceId,
        requested_by: provisionerId,
        status: 'Pending',
      },
      null,
      'PENDING',
    ],
    [
      {
        organization_commitment: organizationCommitment.toString('base64'),
        account_id: instanceId,
        requested_by: provisionerId,
        status: 'Active',
      },
      null,
      'ACTIVE',
    ],
    [null, { contractAccountId: instanceId }, 'BOUND'],
  ])(
    'reports the reload-safe deployment state',
    async (instance, binding, status) => {
      const { service, store } = fixture({ get_instance: instance });
      vi.mocked(store.contractBinding).mockResolvedValue(binding as never);

      await expect(
        service.prepare(principal, organizationId),
      ).resolves.toMatchObject({
        deploymentStatus: status,
        binding,
      });
    },
  );

  it('does not prepare an under-quorum deployment', async () => {
    const { service, store, client } = fixture();
    vi.mocked(store.eligibleContractApprovers).mockResolvedValue([
      { userId: 'owner-user', role: 'OWNER', accountId: 'owner.testnet' },
      { userId: 'owner-user', role: 'OWNER', accountId: 'owner-alt.testnet' },
    ]);
    await expect(service.prepare(principal, organizationId)).rejects.toThrow(
      'Not enough distinct verified approvers',
    );
    expect(client.view).not.toHaveBeenCalled();
  });

  it('prepares the exact call funded and signed by the provisioner', async () => {
    const { service } = fixture({ get_instance: null });
    await expect(
      service.previewSponsoredCall(principal, organizationId, {
        controller: 'owner.testnet',
        approvers: ['owner.testnet', 'approver.testnet'],
      }),
    ).resolves.toEqual({
      network: 'testnet',
      signerId: provisionerId,
      receiverId: factoryId,
      methodName: 'create_policy_instance',
      args: {
        organization_commitment: organizationCommitment.toString('base64'),
        controller: 'owner.testnet',
        policy_digest: Buffer.from(policyDigest, 'hex').toString('base64'),
        approvers: ['approver.testnet', 'owner.testnet'],
        approval_threshold: 2,
      },
      gas: '150000000000000',
      depositYocto: '250000000000000000000000',
      expectedInstanceAccountId: instanceId,
    });
  });

  it('rejects duplicate humans, wrong controller and a pending instance', async () => {
    const { service, store } = fixture({ get_instance: null });
    vi.mocked(store.eligibleContractApprovers).mockResolvedValue([
      { userId: 'owner-user', role: 'OWNER', accountId: 'owner.testnet' },
      { userId: 'owner-user', role: 'OWNER', accountId: 'owner-alt.testnet' },
      {
        userId: 'approver-user',
        role: 'APPROVER',
        accountId: 'approver.testnet',
      },
    ]);
    await expect(
      service.previewSponsoredCall(principal, organizationId, {
        controller: 'owner.testnet',
        approvers: ['owner.testnet', 'owner-alt.testnet'],
      }),
    ).rejects.toThrow('Distinct verified owner and approvers required');
    await expect(
      service.previewSponsoredCall(principal, organizationId, {
        controller: 'approver.testnet',
        approvers: ['owner.testnet', 'approver.testnet'],
      }),
    ).rejects.toThrow('Distinct verified owner and approvers required');
    const pending = fixture({
      get_instance: {
        organization_commitment: organizationCommitment.toString('base64'),
        account_id: instanceId,
        requested_by: provisionerId,
        status: 'Pending',
      },
    });
    await expect(
      pending.service.previewSponsoredCall(principal, organizationId, {
        controller: 'owner.testnet',
        approvers: ['owner.testnet', 'approver.testnet'],
      }),
    ).rejects.toThrow('Policy instance already pending or active');
  });

  it('binds only the active locked instance at one final block', async () => {
    const { service, store, client } = fixture();
    await expect(
      service.bind(principal, organizationId),
    ).resolves.toMatchObject({
      contractAccountId: instanceId,
      required: true,
    });
    expect(client.view).toHaveBeenCalledWith(
      factoryId,
      'get_instance',
      {
        organization_commitment: organizationCommitment.toString('base64'),
      },
      'final-block',
    );
    expect(client.accessKeys).toHaveBeenCalledWith(instanceId, 'final-block');
    expect(store.bindVerifiedContract).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        actorUserId: principal.userId,
        contractAccountId: instanceId,
        policyDigest,
        approvalThreshold: 2,
      }),
    );
  });

  it.each([
    [
      'pending instance',
      {
        get_instance: {
          organization_commitment: organizationCommitment.toString('base64'),
          account_id: instanceId,
          requested_by: provisionerId,
          status: 'Pending',
        },
      },
    ],
    [
      'wrong policy digest',
      {
        get_configuration: {
          state_version: 1,
          controller: 'owner.testnet',
          organization_commitment: organizationCommitment.toString('base64'),
          policy_digest: Buffer.alloc(32).toString('base64'),
          configuration_version: '1',
          approval_threshold: 2,
          approvers: ['approver.testnet', 'owner.testnet'],
          frozen: false,
        },
      },
    ],
  ])('rejects %s without binding', async (_name, overrides) => {
    const { service, store } = fixture(overrides);
    await expect(service.bind(principal, organizationId)).rejects.toThrow(
      'could not be verified',
    );
    expect(store.bindVerifiedContract).not.toHaveBeenCalled();
  });

  it('rejects an instance with an access key', async () => {
    const { service, store, client } = fixture();
    vi.mocked(client.accessKeys).mockResolvedValue(1);
    await expect(service.bind(principal, organizationId)).rejects.toThrow(
      'could not be verified',
    );
    expect(store.bindVerifiedContract).not.toHaveBeenCalled();
  });

  it('rejects an older organization policy version that the new instance cannot match', async () => {
    const { service, store } = fixture();
    vi.mocked(store.activePolicy).mockResolvedValue({
      id: 'policy-id',
      organizationId,
      digest: policyDigest,
      version: 2,
      rules,
    });
    await expect(service.prepare(principal, organizationId)).rejects.toThrow(
      'Policy version must be 1',
    );
    expect(store.bindVerifiedContract).not.toHaveBeenCalled();
  });
});
