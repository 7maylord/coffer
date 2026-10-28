import { DeterministicPolicyEngine } from './policy-engine.js';
import type { ActivePolicy, PolicyRules } from './policy.types.js';

const recipient = 'a'.repeat(64);
const now = new Date('2026-10-30T12:00:00.000Z');
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
  agentCapsAtomic: { agent_1: '400' },
  vendorCapsAtomic: { vendor_1: '500' },
  expiresAt: '2026-11-30T00:00:00.000Z',
  frozen: false,
};

describe('DeterministicPolicyEngine', () => {
  const engine = new DeterministicPolicyEngine();
  const normalized = engine.normalizeRules(rules);
  const policy: ActivePolicy = {
    id: 'policy_1',
    organizationId: 'org_1',
    version: 1,
    digest: engine.policyDigest(normalized),
    rules: normalized,
  };
  const input = {
    organizationId: 'org_1',
    actorId: 'user_1',
    assetId: 'mock:near:usdc',
    chainId: 'near:testnet',
    recipientCommitment: recipient,
    amountAtomic: '101',
    rollingCommittedAtomic: '0',
  };

  it('returns deterministic ALLOW and REQUIRES_APPROVAL decisions', () => {
    expect(
      engine.evaluate(policy, { ...input, amountAtomic: '100' }, now),
    ).toMatchObject({
      outcome: 'ALLOW',
      reasonCodes: [],
      approvalThreshold: 2,
    });
    const first = engine.evaluate(policy, input, now);
    const second = engine.evaluate(policy, input, now);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      outcome: 'REQUIRES_APPROVAL',
      reasonCodes: ['APPROVAL_REQUIRED'],
      policyVersion: 1,
    });
  });

  it('T-POL-01 rejects amounts above the per-transaction cap', () => {
    expect(
      engine.evaluate(policy, { ...input, amountAtomic: '1001' }, now),
    ).toMatchObject({
      outcome: 'DENY',
      reasonCodes: expect.arrayContaining(['PER_TRANSACTION_CAP_EXCEEDED']),
    });
  });

  it('T-POL-02 rejects rolling-window exhaustion using integer arithmetic', () => {
    expect(
      engine.evaluate(
        policy,
        { ...input, amountAtomic: '501', rollingCommittedAtomic: '2000' },
        now,
      ),
    ).toMatchObject({
      outcome: 'DENY',
      reasonCodes: expect.arrayContaining(['ROLLING_WINDOW_CAP_EXCEEDED']),
    });
  });

  it('T-POL-03 rejects a recipient outside the commitment allowlist', () => {
    expect(
      engine.evaluate(
        policy,
        { ...input, recipientCommitment: 'b'.repeat(64) },
        now,
      ),
    ).toMatchObject({
      outcome: 'DENY',
      reasonCodes: ['RECIPIENT_NOT_ALLOWED'],
    });
  });

  it('enforces chain, expiry, freeze, agent, and vendor hard-deny rules', () => {
    expect(
      engine.evaluate(
        { ...policy, rules: { ...policy.rules, frozen: true } },
        {
          ...input,
          chainId: 'near:mainnet',
          amountAtomic: '501',
          agentId: 'agent_1',
          vendorId: 'unknown',
        },
        new Date('2026-12-01T00:00:00.000Z'),
      ).reasonCodes,
    ).toEqual([
      'POLICY_EXPIRED',
      'ORGANIZATION_FROZEN',
      'CHAIN_NOT_ALLOWED',
      'AGENT_CAP_EXCEEDED',
      'VENDOR_NOT_ALLOWED',
    ]);
  });

  it('T-POL-04 fails closed when policy evaluation is unavailable', () => {
    expect(
      engine.evaluateFailClosed(policy, input, now, () => {
        throw new Error('timeout');
      }),
    ).toMatchObject({ outcome: 'DENY', reasonCodes: ['POLICY_UNAVAILABLE'] });
    expect(engine.evaluate(null, input, now)).toMatchObject({
      outcome: 'DENY',
      reasonCodes: ['POLICY_MISSING'],
    });
  });
});
