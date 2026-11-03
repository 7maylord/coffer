# ADR-0010: Encrypted synthetic payroll and strict private-analysis verification

- Status: accepted for the local P0 slice
- Date: 2026-10-30
- Related: COF-501, COF-502, FR-PRV-001-005, T-PRV-01-10, Gate G4

## Context

Payroll contains higher-risk personal and financial data. Connected-wallet
membership alone must not expose another employee's salary or payout account.
NEAR AI Cloud responses also cannot be described as verified private inference
merely because they used an API key or an HTTPS endpoint.

Current provider requirements reviewed for this decision:

- preflight model reports, nonce binding, DCAP/event-log/configuration checks,
  and exact signer matching:
  https://docs.near.ai/cloud/verification/cloud-api/model-attestations
- exact request/response byte hashing and `provider_tee` response signatures:
  https://docs.near.ai/cloud/verification/cloud-api/response-signatures
- OpenAI-compatible API and non-sensitive request identifiers:
  https://docs.near.ai/cloud/guides/openai-compatibility

## Decision

Only explicitly synthetic payroll CSV is accepted. The parser requires one
fixed header, integer atomic amounts, active employee memberships, unique
employee/user rows, bounded text, per-employee and per-batch caps, and at most
500 rows. Formula-prefixed fields, control characters, unexpected columns,
negative/decimal amounts, duplicate mappings, and changed employee-code/user
mappings fail the whole transaction.

Every batch receives a random 256-bit data-encryption key. AES-256-GCM encrypts
gross, net, legal name, address, and payout account with field-specific
additional authenticated data. The data key is itself AES-256-GCM wrapped by a
configured key-encryption key and version. PostgreSQL stores only a
pseudonymous employee code outside ciphertext. Production requires KMS-backed
key management; the local process may use an ephemeral key when no key is
configured, which intentionally cannot survive a restart.

The synthetic calculation is explicitly gross equals net with no tax or legal
payroll claim. A keyed line commitment feeds a versioned manifest digest.
Approval atomically binds that exact digest and optimistic version. Database
triggers reject edits to manifest material, encrypted lines, and analysis runs.
Material changes therefore require another batch and another approval.

Finance roles may read decrypted batch data, and every read is audited.
Employees use an organization-free self endpoint whose repository predicate
binds line, user, active employee membership, and tenant. Failed attempts return
the same not-found response and produce a denial audit when the line exists.
Auditors have a separate purpose-required route that returns commitments and
pseudonymous codes without individual plaintext values.

Deterministic local anomaly analysis is always available and is labeled as
unattested. The NEAR AI adapter requests model evidence with a fresh nonce and
must verify every candidate before it sends salary values. It preserves exact
completion bytes, obtains the response signature, and accepts only an Ed25519
`provider_tee` signature matching exactly one retained preflight-verified model
report. Gateway signatures do not satisfy this policy. Findings may reference
only known line IDs and bounded anomaly fields.

The repository does not bundle an Intel DCAP, event-log, GPU-evidence, and
measurement-policy implementation. Its default model-report verifier therefore
returns unavailable, preventing the completion request and forcing the honest
deterministic fallback. A live private-inference claim remains prohibited until
that verifier is supplied, reviewed, and tested with current provider evidence.

## Consequences

- No payroll plaintext is written to audit metadata, inference records, public
  events, manifests, logs, or contract payloads.
- `FEATURE_PRIVATE_AI` defaults off and also requires a persistent encryption
  key, NEAR AI key, and the explicit NEAR AI provider selection.
- No batch payout route exists in B-09. Approval does not sign or transfer funds.
- Legal payroll calculations, retention/deletion, key rotation, confidential
  payout routing, exports, and operator recovery remain later gated work.
