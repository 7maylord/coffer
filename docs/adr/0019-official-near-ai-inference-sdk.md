# ADR-0019: Official NEAR AI SDK for verified private payroll analysis

- Status: accepted for gated testnet integration
- Date: 2026-11-10
- Related: COF-502, FR-PRV-004–007, FR-AI-004–006, T-PRV-07/08,
  ADR-0010, Gate G4

## Context

Calling an OpenAI-compatible endpoint over HTTPS is not proof that payroll was
processed by an approved confidential-computing deployment. The application
must verify the Gateway, model TEE and response, apply its own measurement
policy, and reject provider output before it enters the payroll domain.

Current provider sources reviewed for this decision:

- official SDK and release source:
  https://github.com/nearai/inference-sdk
- verification guide:
  https://docs.near.ai/cloud/verification/cloud-api/verification-guide
- model attestation requirements:
  https://docs.near.ai/cloud/verification/cloud-api/model-attestations
- response signature requirements:
  https://docs.near.ai/cloud/verification/cloud-api/response-signatures

## Decision

The backend pins `@nearai/inference-sdk` 0.3.0 and imports its Node entry point.
Node 24.22.1 or newer is required by the package and by Coffer. The SDK owns
TLS/SPKI binding, Intel TDX/event-log/config verification, NVIDIA GPU evidence,
request routing-key selection, field encryption and exact retained-response
signature verification. Coffer does not replace any cryptographic verifier.

Before sending a payroll prompt, the adapter calls `verify(model)` and requires
at least one verified model report. The configured policy accepts only
`UpToDate` Gateway/model TCB status, requires GPU evidence, pins the direct
`https://cloud-api.near.ai` origin, and rejects any measured deployment whose
SHA-256 digest is absent from the operator-reviewed allowlist. The digest binds
the authenticated app compose plus OS-image and compose runtime measurements.

Chat uses Ed25519 routing and field-level E2EE. After consuming the completion,
the adapter calls `verifyResponse(id)` and accepts only `provider_tee`, an
Ed25519 signer, one or more verified model attestations, and allowlisted
deployment measurements. A Gateway-signed response fails closed. Only batch
ID, asset ID, line IDs and integer gross amounts are sent; names, addresses,
payout accounts, keys, approvals and signing tools are excluded. Output passes
the existing bounded runtime schema and can recommend review only. It cannot
approve, sign or transfer.

The private-analysis feature remains off unless all gates are present. Failures
are recorded as unavailable or unverified without logging provider bodies or
payroll plaintext. The local deterministic analyzer remains the non-TEE
fallback and is never relabeled private.

The current operator-reviewed model candidate is `z-ai/glm-5.3-flash`, selected
from the provider's public catalog only while it reports ready. Model identity
remains configuration and must be revalidated with the same strict evidence
policy before every request.

The bearer credential is endpoint-specific. Coffer accepts a NEAR AI Cloud key
for `https://cloud-api.near.ai`; a key issued by DeepSeek or another model
vendor cannot authenticate to that Gateway. A DeepSeek model name in the NEAR
catalog identifies the model deployment, not the credential issuer. Connecting
directly to a third-party API would be a separate provider adapter and would
not inherit NEAR AI Gateway attestation, E2EE or response-verification claims.

## Confidentiality boundary

Field-level E2EE protects protocol-covered Chat fields between Coffer and the
attested model. It does not hide all HTTP metadata, the selected model, timing,
response size, locally decrypted payroll, application memory, audit metadata,
or public NEAR transfers. Coffer must not claim confidential payroll payout
because the inference step is verified. OHTTP is not enabled in this slice.

## Consequences and remaining gates

- Operators must review current attestation evidence out of band and configure
  one or more exact deployment digests before enabling the feature.
- Live attestation-only preflight on 2026-11-10 failed closed before inference:
  the SDK reported `gpu.jwt_verification_failed` with NVIDIA evidence
  `not_yet_valid` for both `z-ai/glm-5.3-flash` and
  `Qwen/Qwen3.6-35B-A3B-FP8`. Local and provider HTTP UTC time agreed. No prompt,
  API secret or payroll record was sent, and no deployment digest was approved.
- The SDK's published dependency graph currently emits a peer-version warning
  around its Sigstore/Noble cryptography packages. Coffer does not override
  cryptographic packages to silence it; the provider must resolve or document
  the compatible graph before production approval.
- Production still requires a Node 24.22.1 CI/runtime image, KMS-backed payroll
  encryption, retention/residency policy, red-team and independent security
  review, provider availability/retry design, and a live synthetic attestation
  fixture from an approved deployment.
