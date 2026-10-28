import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AssetRegistry } from '../treasury/asset-registry.js';
import { parseAtomicAmount } from '../treasury/money.js';
import {
  type ActivePolicy,
  type PolicyEvaluation,
  type PolicyEvaluationInput,
  type PolicyReasonCode,
  type PolicyRules,
  PolicyValidationError,
} from './policy.types.js';

const atomicSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine((value) => {
    try {
      parseAtomicAmount(value, { allowZero: true });
      return true;
    } catch {
      return false;
    }
  });
const commitmentSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().min(1).max(192);
const assetLimitSchema = z
  .object({
    perTransactionCapAtomic: atomicSchema,
    rollingWindowCapAtomic: atomicSchema,
    approvalRequiredAboveAtomic: atomicSchema,
  })
  .strict();
export const policyRulesSchema = z
  .object({
    assetLimits: z.record(identifierSchema, assetLimitSchema),
    allowedChainIds: z.array(identifierSchema).min(1).max(32),
    allowedRecipientCommitments: z.array(commitmentSchema).min(1).max(256),
    rollingWindowSeconds: z.number().int().min(60).max(31_536_000),
    approvalThreshold: z.number().int().min(1).max(16),
    agentCapsAtomic: z.record(identifierSchema, atomicSchema),
    vendorCapsAtomic: z.record(identifierSchema, atomicSchema),
    expiresAt: z.string().datetime({ offset: true }),
    frozen: z.boolean(),
  })
  .strict();

export class DeterministicPolicyEngine {
  constructor(private readonly assets = new AssetRegistry()) {}

  normalizeRules(value: unknown): PolicyRules {
    const result = policyRulesSchema.safeParse(value);
    if (!result.success)
      throw new PolicyValidationError('Invalid policy rules');
    const rules = result.data;
    const assetEntries = Object.entries(rules.assetLimits);
    if (assetEntries.length === 0 || assetEntries.length > 32) {
      throw new PolicyValidationError('Policy must contain 1-32 asset limits');
    }
    for (const [assetId, limit] of assetEntries) {
      this.assets.require(assetId);
      if (
        BigInt(limit.approvalRequiredAboveAtomic) >
          BigInt(limit.perTransactionCapAtomic) ||
        BigInt(limit.perTransactionCapAtomic) >
          BigInt(limit.rollingWindowCapAtomic)
      ) {
        throw new PolicyValidationError('Policy asset limits are inconsistent');
      }
    }
    if (
      new Set(rules.allowedChainIds).size !== rules.allowedChainIds.length ||
      new Set(rules.allowedRecipientCommitments).size !==
        rules.allowedRecipientCommitments.length
    ) {
      throw new PolicyValidationError('Policy allowlists contain duplicates');
    }
    return {
      ...rules,
      assetLimits: Object.fromEntries(
        assetEntries.sort(([left], [right]) => left.localeCompare(right)),
      ),
      allowedChainIds: [...rules.allowedChainIds].sort(),
      allowedRecipientCommitments: [
        ...rules.allowedRecipientCommitments,
      ].sort(),
      agentCapsAtomic: sortRecord(rules.agentCapsAtomic),
      vendorCapsAtomic: sortRecord(rules.vendorCapsAtomic),
      expiresAt: new Date(rules.expiresAt).toISOString(),
    };
  }

  policyDigest(rules: PolicyRules): string {
    return sha256Hex(`coffer:policy:v1\n${canonicalJson(rules)}`);
  }

  evaluate(
    policy: ActivePolicy | null,
    input: PolicyEvaluationInput,
    now: Date,
  ): PolicyEvaluation {
    const normalizedInput = normalizeInput(input);
    const inputsDigest = sha256Hex(
      `coffer:policy-input:v1\n${canonicalJson(normalizedInput)}`,
    );
    if (!policy) {
      return denied(inputsDigest, null, null, ['POLICY_MISSING']);
    }
    const reasons: PolicyReasonCode[] = [];
    const rules = policy.rules;
    const limit = rules.assetLimits[normalizedInput.assetId];
    const amount = BigInt(normalizedInput.amountAtomic);
    const rollingCommitted = BigInt(normalizedInput.rollingCommittedAtomic);
    if (Date.parse(rules.expiresAt) <= now.getTime())
      reasons.push('POLICY_EXPIRED');
    if (rules.frozen) reasons.push('ORGANIZATION_FROZEN');
    if (!limit) reasons.push('ASSET_NOT_ALLOWED');
    if (!rules.allowedChainIds.includes(normalizedInput.chainId)) {
      reasons.push('CHAIN_NOT_ALLOWED');
    }
    if (
      !rules.allowedRecipientCommitments.includes(
        normalizedInput.recipientCommitment,
      )
    ) {
      reasons.push('RECIPIENT_NOT_ALLOWED');
    }
    if (limit && amount > BigInt(limit.perTransactionCapAtomic)) {
      reasons.push('PER_TRANSACTION_CAP_EXCEEDED');
    }
    if (
      limit &&
      rollingCommitted + amount > BigInt(limit.rollingWindowCapAtomic)
    ) {
      reasons.push('ROLLING_WINDOW_CAP_EXCEEDED');
    }
    evaluateScopedCap(
      normalizedInput.agentId,
      rules.agentCapsAtomic,
      amount,
      'AGENT_NOT_ALLOWED',
      'AGENT_CAP_EXCEEDED',
      reasons,
    );
    evaluateScopedCap(
      normalizedInput.vendorId,
      rules.vendorCapsAtomic,
      amount,
      'VENDOR_NOT_ALLOWED',
      'VENDOR_CAP_EXCEEDED',
      reasons,
    );
    if (reasons.length > 0) {
      return denied(inputsDigest, policy.digest, policy.version, reasons);
    }
    if (limit && amount > BigInt(limit.approvalRequiredAboveAtomic)) {
      return {
        outcome: 'REQUIRES_APPROVAL',
        reasonCodes: ['APPROVAL_REQUIRED'],
        inputsDigest,
        policyDigest: policy.digest,
        policyVersion: policy.version,
        approvalThreshold: rules.approvalThreshold,
      };
    }
    return {
      outcome: 'ALLOW',
      reasonCodes: [],
      inputsDigest,
      policyDigest: policy.digest,
      policyVersion: policy.version,
      approvalThreshold: rules.approvalThreshold,
    };
  }

  evaluateFailClosed(
    policy: ActivePolicy | null,
    input: PolicyEvaluationInput,
    now: Date,
    evaluator: (
      policy: ActivePolicy | null,
      input: PolicyEvaluationInput,
      now: Date,
    ) => PolicyEvaluation = this.evaluate.bind(this),
  ): PolicyEvaluation {
    try {
      return evaluator(policy, input, now);
    } catch {
      const inputsDigest = sha256Hex(
        `coffer:policy-input:v1\n${canonicalJson(normalizeInput(input))}`,
      );
      return denied(
        inputsDigest,
        policy?.digest ?? null,
        policy?.version ?? null,
        ['POLICY_UNAVAILABLE'],
      );
    }
  }
}

function normalizeInput(input: PolicyEvaluationInput): PolicyEvaluationInput {
  return {
    ...input,
    amountAtomic: parseAtomicAmount(input.amountAtomic).toString(),
    rollingCommittedAtomic: parseAtomicAmount(input.rollingCommittedAtomic, {
      allowZero: true,
    }).toString(),
    recipientCommitment: input.recipientCommitment.toLowerCase(),
  };
}

function evaluateScopedCap(
  identifier: string | undefined,
  caps: Record<string, string>,
  amount: bigint,
  missing: PolicyReasonCode,
  exceeded: PolicyReasonCode,
  reasons: PolicyReasonCode[],
): void {
  if (!identifier) return;
  const cap = caps[identifier];
  if (cap === undefined) reasons.push(missing);
  else if (amount > BigInt(cap)) reasons.push(exceeded);
}

function denied(
  inputsDigest: string,
  policyDigest: string | null,
  policyVersion: number | null,
  reasonCodes: PolicyReasonCode[],
): PolicyEvaluation {
  return {
    outcome: 'DENY',
    reasonCodes,
    inputsDigest,
    policyDigest,
    policyVersion,
    approvalThreshold: null,
  };
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
