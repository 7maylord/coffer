import { createHash } from 'node:crypto';

const DOMAIN = Buffer.from('coffer:proposal:v1', 'utf8');
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export interface ProposalDigestInput {
  organizationCommitment: Uint8Array;
  proposalType: string;
  proposalId: Uint8Array;
  revision: bigint;
  policyVersion: bigint;
  policyDigest: Uint8Array;
  chainId: string;
  assetId: string;
  amountAtomic: bigint;
  authorizedMaxAtomic: bigint;
  recipientCommitment: Uint8Array;
  expiresAtNs: bigint;
  nonce: Uint8Array;
  idempotencyKeyCommitment: Uint8Array;
  operation: string;
  environment: string;
}

export function canonicalProposalDigest(input: ProposalDigestInput): Buffer {
  return createHash('sha256')
    .update(
      Buffer.concat([
        lengthPrefixed(DOMAIN),
        fixed32(input.organizationCommitment, 'organizationCommitment'),
        boundedText(input.proposalType, 32, 'proposalType'),
        fixed32(input.proposalId, 'proposalId'),
        unsignedBigEndian(input.revision, 8, U64_MAX, 'revision'),
        unsignedBigEndian(input.policyVersion, 8, U64_MAX, 'policyVersion'),
        fixed32(input.policyDigest, 'policyDigest'),
        boundedText(input.chainId, 64, 'chainId'),
        boundedText(input.assetId, 192, 'assetId'),
        unsignedBigEndian(input.amountAtomic, 16, U128_MAX, 'amountAtomic'),
        unsignedBigEndian(
          input.authorizedMaxAtomic,
          16,
          U128_MAX,
          'authorizedMaxAtomic',
        ),
        fixed32(input.recipientCommitment, 'recipientCommitment'),
        unsignedBigEndian(input.expiresAtNs, 8, U64_MAX, 'expiresAtNs'),
        fixed32(input.nonce, 'nonce'),
        fixed32(input.idempotencyKeyCommitment, 'idempotencyKeyCommitment'),
        boundedText(input.operation, 64, 'operation'),
        boundedText(input.environment, 32, 'environment'),
      ]),
    )
    .digest();
}

export function hex32(value: string, field: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${field} must be 32-byte lowercase hex`);
  }
  return Buffer.from(value, 'hex');
}

export function commitment(domain: string, value: string): Buffer {
  return createHash('sha256').update(`${domain}\n${value}`).digest();
}

function boundedText(value: string, maxBytes: number, field: string): Buffer {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length === 0 || encoded.length > maxBytes) {
    throw new RangeError(`${field} must contain 1-${maxBytes} UTF-8 bytes`);
  }
  return lengthPrefixed(encoded);
}

function lengthPrefixed(value: Uint8Array): Buffer {
  if (value.byteLength > 0xffff_ffff) {
    throw new RangeError('length-prefixed value exceeds u32');
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.byteLength);
  return Buffer.concat([length, Buffer.from(value)]);
}

function fixed32(value: Uint8Array, field: string): Buffer {
  if (value.byteLength !== 32) {
    throw new RangeError(`${field} must be exactly 32 bytes`);
  }
  return Buffer.from(value);
}

function unsignedBigEndian(
  value: bigint,
  width: number,
  maximum: bigint,
  field: string,
): Buffer {
  if (value < 0n || value > maximum) {
    throw new RangeError(
      `${field} is outside its unsigned ${width * 8}-bit range`,
    );
  }
  const output = Buffer.alloc(width);
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}
