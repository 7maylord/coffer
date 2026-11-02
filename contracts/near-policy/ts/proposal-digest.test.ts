import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalProposalDigest,
  type ProposalDigestInput,
} from "./proposal-digest.ts";
import type { NearPolicyContractInterface } from "./contract-interface.ts";

interface GoldenVector {
  input: {
    organization_commitment_byte: number;
    proposal_type: string;
    proposal_id_byte: number;
    revision: string;
    policy_version: string;
    policy_digest_byte: number;
    chain_id: string;
    asset_id: string;
    amount_atomic: string;
    authorized_max_atomic: string;
    recipient_commitment_byte: number;
    expires_at_ns: string;
    nonce_byte: number;
    idempotency_key_commitment_byte: number;
    operation: string;
    environment: string;
  };
  expected_sha256_hex: string;
}

const vectorPath = fileURLToPath(
  new URL("../test-vectors/proposal-v1.json", import.meta.url),
);
const vector = JSON.parse(readFileSync(vectorPath, "utf8")) as GoldenVector;
const repeated = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);

function goldenInput(): ProposalDigestInput {
  const input = vector.input;
  return {
    organizationCommitment: repeated(input.organization_commitment_byte),
    proposalType: input.proposal_type,
    proposalId: repeated(input.proposal_id_byte),
    revision: BigInt(input.revision),
    policyVersion: BigInt(input.policy_version),
    policyDigest: repeated(input.policy_digest_byte),
    chainId: input.chain_id,
    assetId: input.asset_id,
    amountAtomic: BigInt(input.amount_atomic),
    authorizedMaxAtomic: BigInt(input.authorized_max_atomic),
    recipientCommitment: repeated(input.recipient_commitment_byte),
    expiresAtNs: BigInt(input.expires_at_ns),
    nonce: repeated(input.nonce_byte),
    idempotencyKeyCommitment: repeated(
      input.idempotency_key_commitment_byte,
    ),
    operation: input.operation,
    environment: input.environment,
  };
}

test("TypeScript matches the Rust coffer:proposal:v1 golden vector", () => {
  const actual = canonicalProposalDigest(goldenInput());

  assert.equal(actual.toString("hex"), vector.expected_sha256_hex);
});

test("TypeScript rejects oversized and non-atomic digest inputs", () => {
  assert.throws(
    () => canonicalProposalDigest({ ...goldenInput(), proposalType: "x".repeat(33) }),
    RangeError,
  );
  assert.throws(
    () => canonicalProposalDigest({ ...goldenInput(), amountAtomic: -1n }),
    RangeError,
  );
});

// Compile-time fixture: consumers bind their NEAR client wrapper to this view surface.
const contractFixture: NearPolicyContractInterface | undefined = undefined;
assert.equal(contractFixture, undefined);
