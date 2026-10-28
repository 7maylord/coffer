import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalProposalDigest } from './proposal-digest.js';

describe('canonicalProposalDigest', () => {
  it('T-CON-10 matches the Rust contract golden vector byte-for-byte', () => {
    const vector = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../../contracts/near-policy/test-vectors/proposal-v1.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    ) as {
      input: Record<string, string | number>;
      expected_sha256_hex: string;
    };
    const input = vector.input;
    const repeated = (field: string) => Buffer.alloc(32, Number(input[field]));
    const digest = canonicalProposalDigest({
      organizationCommitment: repeated('organization_commitment_byte'),
      proposalType: String(input.proposal_type),
      proposalId: repeated('proposal_id_byte'),
      revision: BigInt(String(input.revision)),
      policyVersion: BigInt(String(input.policy_version)),
      policyDigest: repeated('policy_digest_byte'),
      chainId: String(input.chain_id),
      assetId: String(input.asset_id),
      amountAtomic: BigInt(String(input.amount_atomic)),
      authorizedMaxAtomic: BigInt(String(input.authorized_max_atomic)),
      recipientCommitment: repeated('recipient_commitment_byte'),
      expiresAtNs: BigInt(String(input.expires_at_ns)),
      nonce: repeated('nonce_byte'),
      idempotencyKeyCommitment: repeated('idempotency_key_commitment_byte'),
      operation: String(input.operation),
      environment: String(input.environment),
    });
    expect(digest.toString('hex')).toBe(vector.expected_sha256_hex);
  });

  it('rejects malformed fixed fields and values outside contract integer ranges', () => {
    const base = {
      organizationCommitment: Buffer.alloc(32),
      proposalType: 'payment',
      proposalId: Buffer.alloc(32),
      revision: 1n,
      policyVersion: 1n,
      policyDigest: Buffer.alloc(32),
      chainId: 'near:testnet',
      assetId: 'near:testnet:native',
      amountAtomic: 1n,
      authorizedMaxAtomic: 1n,
      recipientCommitment: Buffer.alloc(32),
      expiresAtNs: 1n,
      nonce: Buffer.alloc(32),
      idempotencyKeyCommitment: Buffer.alloc(32),
      operation: 'transfer',
      environment: 'testnet',
    };
    expect(() =>
      canonicalProposalDigest({ ...base, revision: 1n << 64n }),
    ).toThrow(RangeError);
    expect(() =>
      canonicalProposalDigest({ ...base, policyDigest: Buffer.alloc(31) }),
    ).toThrow(RangeError);
  });
});
