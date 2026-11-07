import { randomUUID } from 'node:crypto';
import { MembershipRole, PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import {
  NearPolicyContractVerifier,
  type NearFinalViewClient,
} from '../src/policy/near-policy-contract.js';
import { DeterministicPolicyEngine } from '../src/policy/policy-engine.js';
import { PolicyService } from '../src/policy/policy.service.js';
import { PrismaPolicyStore } from '../src/policy/prisma-policy.store.js';
import type { PolicyRules } from '../src/policy/policy.types.js';

describe('policy and proposal transaction invariants', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const store = new PrismaPolicyStore(environment);
  const unavailableClient: NearFinalViewClient = {
    accessKeys: vi.fn().mockRejectedValue(new Error('not configured')),
    view: vi.fn().mockRejectedValue(new Error('not configured')),
    codeHash: vi.fn().mockRejectedValue(new Error('not configured')),
  };
  const service = new PolicyService(
    store,
    new DeterministicPolicyEngine(),
    new NearPolicyContractVerifier(unavailableClient),
    environment,
  );
  const suffix = randomUUID().slice(0, 8);
  const recipient = 'a'.repeat(64);
  const rules: PolicyRules = {
    assetLimits: {
      'mock:near:usdc': {
        perTransactionCapAtomic: '1000',
        rollingWindowCapAtomic: '2500',
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
  let organizationId: string;
  let otherOrganizationId: string;
  let ownerId: string;
  let approverAId: string;
  let approverBId: string;

  beforeAll(async () => {
    const [owner, approverA, approverB] = await Promise.all(
      ['owner', 'approver-a', 'approver-b'].map((name) =>
        prisma.user.create({
          data: {
            displayName: name,
            walletAccounts: {
              create: {
                network: 'testnet',
                accountId: `${name}-${suffix}.testnet`,
                lastPublicKey: 'ed25519:11111111111111111111111111111111',
                verifiedAt: new Date(),
              },
            },
          },
        }),
      ),
    );
    ownerId = owner.id;
    approverAId = approverA.id;
    approverBId = approverB.id;
    await prisma.walletAccount.create({
      data: {
        userId: approverAId,
        network: 'testnet',
        accountId: `approver-a-alt-${suffix}.testnet`,
        lastPublicKey: 'ed25519:11111111111111111111111111111111',
        verifiedAt: new Date(),
      },
    });
    const organization = await prisma.organization.create({
      data: {
        slug: `policy-${suffix}`,
        name: 'Policy Integration Fixture',
        memberships: {
          create: [
            { userId: ownerId, role: MembershipRole.OWNER },
            { userId: approverAId, role: MembershipRole.APPROVER },
            { userId: approverBId, role: MembershipRole.APPROVER },
          ],
        },
      },
    });
    organizationId = organization.id;
    otherOrganizationId = (
      await prisma.organization.create({
        data: { slug: `other-policy-${suffix}`, name: 'Other Tenant' },
      })
    ).id;
  });

  afterAll(async () => {
    await store.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('activates a policy and creates a deterministic immutable proposal', async () => {
    const policy = await service.activate(ownerId, organizationId, rules);
    expect(policy).toMatchObject({ organizationId, version: 1 });
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    const proposal = await service.create(
      ownerId,
      organizationId,
      material('101', new Date('2026-11-01T00:00:00.000Z')),
      new Date('2026-10-30T00:00:00.000Z'),
    );
    expect(proposal).toMatchObject({
      organizationId,
      revision: 1,
      status: 'PENDING',
      approvalThreshold: 2,
      approvals: [],
    });
    expect(proposal.instructionDigest).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      service.get(otherOrganizationId, proposal.id),
    ).rejects.toThrow();
  });

  it('T-POL-06 counts one human once even when that user has two verified wallets', async () => {
    const proposal = await latest();
    const principalA = {
      sessionId: 'session-a',
      userId: approverAId,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      wallets: [
        { network: 'testnet', accountId: `approver-a-${suffix}.testnet` },
        { network: 'testnet', accountId: `approver-a-alt-${suffix}.testnet` },
      ],
      memberships: [{ organizationId, role: 'APPROVER' }],
    };
    await expect(
      service.approve(
        principalA,
        organizationId,
        proposal.id,
        `approver-a-${suffix}.testnet`,
        new Date('2026-10-30T00:01:00.000Z'),
      ),
    ).resolves.toMatchObject({
      status: 'PENDING',
      approvals: [expect.anything()],
    });
    await expect(
      service.approve(
        principalA,
        organizationId,
        proposal.id,
        `approver-a-alt-${suffix}.testnet`,
        new Date('2026-10-30T00:02:00.000Z'),
      ),
    ).rejects.toThrow('Approver already approved');
    await expect(
      service.approve(
        {
          sessionId: 'session-b',
          userId: approverBId,
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          wallets: [
            { network: 'testnet', accountId: `approver-b-${suffix}.testnet` },
          ],
          memberships: [{ organizationId, role: 'APPROVER' }],
        },
        organizationId,
        proposal.id,
        `approver-b-${suffix}.testnet`,
        new Date('2026-10-30T00:03:00.000Z'),
      ),
    ).resolves.toMatchObject({ status: 'APPROVED', approvals: [{}, {}] });
  });

  it('T-POL-05 material revision changes the digest and does not inherit approvals', async () => {
    const previous = await latest();
    const revised = await service.revise(
      ownerId,
      organizationId,
      previous.id,
      material('102', new Date('2026-11-02T00:00:00.000Z')),
      new Date('2026-10-30T00:04:00.000Z'),
    );
    expect(revised).toMatchObject({
      proposalKey: previous.proposalKey,
      revision: 2,
      status: 'PENDING',
      approvals: [],
    });
    expect(revised.instructionDigest).not.toBe(previous.instructionDigest);
    await expect(
      service.get(organizationId, previous.id),
    ).resolves.toMatchObject({
      status: 'SUPERSEDED',
      approvals: [{}, {}],
    });
  });

  it('marks open revisions stale when the owner activates a new policy', async () => {
    const current = await latest();
    const next = await service.activate(ownerId, organizationId, {
      ...rules,
      assetLimits: {
        'mock:near:usdc': {
          ...rules.assetLimits['mock:near:usdc'],
          rollingWindowCapAtomic: '2600',
        },
      },
    });
    expect(next.version).toBe(2);
    await expect(
      service.get(organizationId, current.id),
    ).resolves.toMatchObject({
      status: 'STALE_POLICY',
    });
  });

  it('serializes concurrent proposals so the rolling cap cannot be overspent', async () => {
    await service.activate(ownerId, organizationId, {
      ...rules,
      assetLimits: {
        'mock:near:usdc': {
          perTransactionCapAtomic: '2000',
          rollingWindowCapAtomic: '2500',
          approvalRequiredAboveAtomic: '100',
        },
      },
    });
    const now = new Date('2026-10-30T00:10:00.000Z');
    const originalRollingCommitted = store.rollingCommitted.bind(store);
    let waiting = 0;
    let release!: () => void;
    const bothEvaluated = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.rollingCommitted = async (input) => {
      const committed = await originalRollingCommitted(input);
      waiting += 1;
      if (waiting === 2) release();
      await bothEvaluated;
      return committed;
    };
    const results = await Promise.allSettled([
      service.create(
        ownerId,
        organizationId,
        material('1400', new Date('2026-11-03T00:00:00.000Z')),
        now,
      ),
      service.create(
        ownerId,
        organizationId,
        material('1400', new Date('2026-11-03T00:00:00.000Z')),
        now,
      ),
    ]).finally(() => {
      store.rollingCommitted = originalRollingCommitted;
    });
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining('Rolling window cap'),
      }),
    });
  });

  it('rechecks approver membership revocation immediately before execution', async () => {
    await service.activate(ownerId, organizationId, rules);
    const proposal = await service.create(
      ownerId,
      organizationId,
      material('101', new Date('2026-11-04T00:00:00.000Z')),
      new Date('2026-10-30T00:20:00.000Z'),
    );
    await service.approve(
      principal(approverAId, `approver-a-${suffix}.testnet`),
      organizationId,
      proposal.id,
      `approver-a-${suffix}.testnet`,
      new Date('2026-10-30T00:21:00.000Z'),
    );
    await service.approve(
      principal(approverBId, `approver-b-${suffix}.testnet`),
      organizationId,
      proposal.id,
      `approver-b-${suffix}.testnet`,
      new Date('2026-10-30T00:22:00.000Z'),
    );
    await expect(
      service.verifyForExecution(
        organizationId,
        proposal.id,
        new Date('2026-10-30T00:23:00.000Z'),
      ),
    ).resolves.toEqual({ executable: true, verification: 'offchain' });
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: approverBId } },
      data: { revokedAt: new Date('2026-10-30T00:23:30.000Z') },
    });
    await expect(
      service.verifyForExecution(
        organizationId,
        proposal.id,
        new Date('2026-10-30T00:24:00.000Z'),
      ),
    ).rejects.toThrow('Approval quorum is no longer authorized');
  });

  it('binds a verified factory instance once, auditing the owner and rejecting one-human quorum', async () => {
    const active = await service.activate(ownerId, organizationId, rules);
    const input = {
      organizationId,
      actorUserId: ownerId,
      network: 'testnet',
      contractAccountId: `instance-${suffix}.testnet`,
      expectedCodeHash: 'EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj',
      organizationCommitment: 'd'.repeat(64),
      policyDigest: active.digest,
      policyVersion: active.version,
      approvalThreshold: 2,
      controller: `owner-${suffix}.testnet`,
      approvers: [`owner-${suffix}.testnet`, `approver-a-${suffix}.testnet`],
    };
    await expect(
      store.bindVerifiedContract({
        ...input,
        approvers: [
          `approver-a-${suffix}.testnet`,
          `approver-a-alt-${suffix}.testnet`,
        ],
      }),
    ).rejects.toThrow('Distinct eligible owner and approvers required');
    const binding = await store.bindVerifiedContract(input);
    expect(binding).toMatchObject({
      organizationId,
      contractAccountId: input.contractAccountId,
      required: true,
    });
    expect(await store.bindVerifiedContract(input)).toMatchObject({
      id: binding.id,
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          organizationId,
          eventType: 'POLICY_CONTRACT_BOUND',
          entityId: binding.id,
        },
      }),
    ).toBe(1);
    await expect(
      store.bindVerifiedContract({
        ...input,
        contractAccountId: `other-${suffix}.testnet`,
      }),
    ).rejects.toThrow('different contract binding');
  });

  async function latest() {
    const proposal = await prisma.financialProposal.findFirstOrThrow({
      where: { organizationId },
      orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
    });
    return service.get(organizationId, proposal.id);
  }

  function material(amountAtomic: string, expiresAt: Date) {
    return {
      proposalType: 'invoice_payment',
      chainId: 'near:testnet',
      assetId: 'mock:near:usdc',
      amountAtomic,
      authorizedMaxAtomic: amountAtomic,
      recipientCommitment: recipient,
      expiresAt,
      nonceCommitment: 'b'.repeat(64),
      idempotencyKeyCommitment: randomUUID()
        .replaceAll('-', '')
        .padEnd(64, '0'),
      operation: 'transfer',
      environment: 'testnet',
    };
  }

  function principal(userId: string, accountId: string) {
    return {
      sessionId: `session-${userId}`,
      userId,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      wallets: [{ network: 'testnet', accountId }],
      memberships: [{ organizationId, role: 'APPROVER' as const }],
    };
  }
});
