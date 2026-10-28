import type { SessionPrincipal } from '../auth/auth.types.js';
import type { PolicyService } from '../policy/policy.service.js';
import type { LedgerService } from './ledger.service.js';
import {
  TREASURY_SPLIT_COMMITMENT,
  TreasuryWorkflowService,
} from './treasury-workflow.service.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const ledger = {
    accounts: vi.fn().mockResolvedValue([]),
    account: vi.fn().mockResolvedValue({
      id: accountId,
      organizationId,
      assetId: 'mock:near:usdc',
      accountType: 'ASSET',
      availableBalanceAtomic: '20000000000',
    }),
    reserve: vi.fn().mockResolvedValue({
      reservation: { id: 'reservation-id' },
      created: true,
    }),
  };
  const policies = {
    activeOrNull: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    activate: vi.fn(),
    create: vi.fn().mockImplementation((_actor, _org, material) =>
      Promise.resolve({
        id: proposalId,
        ...material,
      }),
    ),
    get: vi.fn(),
    revise: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
    verifyForExecution: vi.fn().mockResolvedValue({
      executable: true,
      verification: 'offchain',
    }),
  };
  return {
    ledger,
    policies,
    service: new TreasuryWorkflowService(
      ledger as unknown as LedgerService,
      policies as unknown as PolicyService,
    ),
  };
}

function approvedProposal() {
  return {
    id: proposalId,
    organizationId,
    proposalType: 'treasury_split',
    assetId: 'mock:near:usdc',
    chainId: 'internal:ledger',
    recipientCommitment: TREASURY_SPLIT_COMMITMENT,
    operation: `reserve_split:${accountId}`,
    amountAtomic: '10000000001',
    authorizedMaxAtomic: '10000000001',
    environment: 'mock',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  };
}

describe('TreasuryWorkflowService', () => {
  it('T-LED-06 assigns an atomic-unit remainder to payroll', () => {
    const { service } = fixture();
    expect(service.preview('10001').allocations).toEqual([
      { recipientId: 'payroll', basisPoints: 5000, amountAtomic: '5001' },
      { recipientId: 'operations', basisPoints: 3000, amountAtomic: '3000' },
      {
        recipientId: 'partner_distributions',
        basisPoints: 2000,
        amountAtomic: '2000',
      },
    ]);
  });

  it('derives all authorization material on the server', async () => {
    const { service, policies } = fixture();
    const created = await service.createProposal(
      'actor-id',
      organizationId,
      {
        sourceAccountId: accountId,
        amountAtomic: '10000000000',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      'request-12345678',
    );

    expect(created.id).toBe(proposalId);
    expect(policies.create).toHaveBeenCalledWith(
      'actor-id',
      organizationId,
      expect.objectContaining({
        proposalType: 'treasury_split',
        chainId: 'internal:ledger',
        assetId: 'mock:near:usdc',
        amountAtomic: '10000000000',
        authorizedMaxAtomic: '10000000000',
        recipientCommitment: TREASURY_SPLIT_COMMITMENT,
        operation: `reserve_split:${accountId}`,
        environment: 'mock',
        nonceCommitment: expect.stringMatching(/^[a-f0-9]{64}$/),
        idempotencyKeyCommitment: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('rejects a split above the ledger-derived available balance', async () => {
    const { service, policies } = fixture();
    await expect(
      service.createProposal(
        'actor-id',
        organizationId,
        {
          sourceAccountId: accountId,
          amountAtomic: '20000000001',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        'request-12345678',
      ),
    ).rejects.toThrow('exceeds available');
    expect(policies.create).not.toHaveBeenCalled();
  });

  it('reverifies the exact approved revision before an idempotent reservation', async () => {
    const { service, policies, ledger } = fixture();
    policies.get.mockResolvedValue(approvedProposal());

    const result = await service.reserve(organizationId, proposalId);

    expect(policies.verifyForExecution).toHaveBeenCalledWith(
      organizationId,
      proposalId,
    );
    expect(ledger.reserve).toHaveBeenCalledWith({
      organizationId,
      assetId: 'mock:near:usdc',
      accountId,
      reference: `treasury-split:${proposalId}`,
      amountAtomic: '10000000001',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    expect(result.created).toBe(true);
  });

  it('does not reserve when final policy verification fails', async () => {
    const { service, policies, ledger } = fixture();
    policies.get.mockResolvedValue(approvedProposal());
    policies.verifyForExecution.mockRejectedValue(new Error('RPC unavailable'));

    await expect(service.reserve(organizationId, proposalId)).rejects.toThrow(
      'RPC unavailable',
    );
    expect(ledger.reserve).not.toHaveBeenCalled();
  });

  it('rejects generic proposals that do not preserve fixed workflow invariants', async () => {
    const { service, policies, ledger } = fixture();
    policies.get.mockResolvedValue({
      ...approvedProposal(),
      environment: 'mainnet',
    });

    await expect(service.reserve(organizationId, proposalId)).rejects.toThrow(
      'not a Coffer treasury split',
    );
    expect(policies.verifyForExecution).not.toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
  });

  it('delegates approval only after confirming the treasury commitment', async () => {
    const { service, policies } = fixture();
    const proposal = approvedProposal();
    policies.get.mockResolvedValue(proposal);
    policies.approve.mockResolvedValue(proposal);
    const principal = {
      userId: 'approver-id',
    } as SessionPrincipal;

    await service.approve(
      principal,
      organizationId,
      proposalId,
      'approver.testnet',
    );

    expect(policies.approve).toHaveBeenCalledWith(
      principal,
      organizationId,
      proposalId,
      'approver.testnet',
    );
  });
});
