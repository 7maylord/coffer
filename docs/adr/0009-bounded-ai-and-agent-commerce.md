# ADR-0009: Bounded AI suggestions and policy-governed mock agent commerce

- Status: accepted for the local P0 mock slice
- Date: 2026-10-30
- Related: COF-401, COF-402, COF-403, FR-AI-001-004, FR-AGT-001-004, T-AI-01-05, T-AGT-01-06, Gate G4

## Context

AI output and vendor responses are untrusted. Neither may choose a destination,
raise an authorized amount, grant an approval, fetch an arbitrary URL, write a
ledger entry, or initiate a payment. Current NEAR AI Cloud documentation also
requires preflight attestation evidence and exact request/response bytes before
a response can be described as verified.

References reviewed at this checkpoint:

- NEAR AI Cloud OpenAI-compatible endpoint and request-ID behavior:
  https://docs.near.ai/cloud/guides/openai-compatibility
- NEAR model-attestation preflight and nonce/signer requirements:
  https://docs.near.ai/cloud/verification/cloud-api/model-attestations
- exact-byte response-signature verification:
  https://docs.near.ai/cloud/verification/cloud-api/response-signatures

## Decision

Coffer exposes a provider-neutral CFO inference interface. The default adapter
is deterministic and local. The NEAR AI adapter is separately gated, uses a
server-only API key, a configured canonical model ID, `x-no-aliasing: true`, a
bounded response, no tools, and only tenant-scoped invoice identifiers, status,
asset and atomic amount metadata. The database stores input/response digests,
provider, model, template version, classification, validation result and
attestation status. It does not store the plaintext prompt.

Model output must match one strict allocation schema. Categories and evidence
must be subsets of the authorized request and atomic allocations must sum
exactly to the human-supplied maximum. Extra transfer, destination, account,
tool or policy fields fail validation. A validated suggestion remains pending;
only an authorized human decision creates an idempotent ledger reservation.

The P0 service registry contains one in-process mock document-classification
vendor. Requests contain no URL. Coffer reconstructs the controlled offer from
the registry, verifies vendor identity, request digest, asset, chain, price,
recipient commitment and expiry, and hashes those terms. Purchase claims use a
serializable transaction, unique offer constraint, per-purchase cap and a
bounded rolling-time budget (24 hours by default, explicitly stored per agent).
PostgreSQL rejects later changes to the agent's authority fields or the stored
offer, validates digest shapes and positive amounts, and prevents cross-tenant
links to inference runs, reservations, and financial proposals. A purchase
creates the existing immutable central-policy proposal and
mock fulfillment revalidates agent status, offer digest, policy, quorum and
verified wallet approval.

An allowed Finance Agent reservation emits one durable procurement request only
when agent execution is explicitly enabled. The processor fails closed unless
exactly one active tenant agent matches the run asset, the fixed seeded service
and the fixed vendor registration. It requests one financial-document
classification offer, rejects a price above the reserved run amount, links the
agent, offer and purchase to the run through tenant-scoped foreign keys, and
stops at `PROCUREMENT_AWAITING_APPROVAL`. Outbox replay cannot request a second
offer or proposal after that state is recorded. The purchase UUID is also the
immutable proposal key. If the process stops after proposal creation but before
purchase linkage, retry retrieves the same revision, verifies every
authority-bearing field, and completes the link.

## Known incomplete work

- No real NEAR AI request was made. HTTP behavior is fixture-tested only.
- Attestation reports, DCAP/NVIDIA evidence, TLS binding and exact-byte response
  signatures are not cryptographically verified in B-08. NEAR AI responses are
  stored and returned as `UNVERIFIED`; Coffer does not claim private inference.
- The vendor, deliverable and payment reference are mock-only. There is no
  Agent Connect, external vendor endpoint or real settlement.
- A run with no single exact eligible agent stops at
  `PROCUREMENT_CONFIGURATION_REQUIRED`; there is no automatic agent selection
  fallback or authority widening.
- A retry resumes a durable `CLAIMED` purchase and reuses either the linked
  proposal or the exact deterministic purchase-keyed proposal created before a
  crash. Conflicting material fails closed; no second purchase or proposal can
  bypass the original offer claim.
- A CFO reservation created immediately before a database decision failure is
  idempotently recoverable by retry, but no operator recovery view exists yet.
- Frontend review, warnings, diffs and execution badges remain F-04 work.

These gaps prevent a claim that Gate G4 or production AI/agent commerce is
complete, even though the local B-08 mock/API acceptance slice is implemented.
