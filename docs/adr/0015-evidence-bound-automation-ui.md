# ADR-0015: Evidence-bound CFO and controlled agent-commerce UI

- **Status:** Accepted
- **Date:** 2026-11-01
- **Requirements:** J-03, FR-AI-001–004, FR-AGT-001–004, COF-401–403
- **Gate:** F-04 local implementation evidence; G4 remains incomplete

## Context

The public design demo visualized a CFO allocation and an agent offer using
browser state. The backend already enforced strict CFO output schemas, scoped
invoice evidence, immutable typed offers, agent budgets and central policy, but
the canonical routes did not expose that evidence or let authorized people use
the controlled workflow. A production-facing screen must not convert model or
vendor prose into a destination, amount, permission or transfer instruction.

NEAR AI Cloud provides private, verifiable inference capabilities, but this
repository's CFO adapter does not yet verify the model-attestation report,
NVIDIA NRAS evidence, Intel TDX binding and exact response signature. Any NEAR
AI response must therefore remain visibly `UNVERIFIED`; schema validation alone
is not an attestation or privacy claim.

## Decision

Canonical `/cfo` reads a bounded tenant workspace and combines it with existing
invoice and ledger APIs. The browser selects one issued invoice, a server-owned
source ledger account and an exact integer maximum. It may choose only a fixed
category set. The backend supplies scoped invoice metadata to the configured
provider and rejects additional fields, unknown evidence, changed categories or
amounts over the maximum. The UI renders reason and uncertainty as untrusted
evidence. Human approval creates an idempotent internal ledger reservation; it
does not sign or transfer.

Canonical `/agents` reads the registered bounded agents, normalized offers and
purchase evidence. Agent creation fixes the only action, mock asset, mock chain,
seeded vendor, per-purchase cap, rolling budget and expiry. An owner can
explicitly merge those bounds into the existing versioned central policy. This
may stale older policy-bound proposals, so it is not automatic.

The offer screen renders only normalized controlled fields retained by the
backend: vendor, service, exact integer price, controlled terms, request/offer
digests, expiry and the pre-registered recipient commitment. Vendor prose is
discarded before persistence and cannot supply a URL or authorization input.
Purchase creation binds the exact offer to a central-policy proposal. Approval
uses a NEAR account already verified by the current session and requires the
existing distinct-person quorum. Execution revalidates policy and offer bounds
before recording seeded mock fulfillment.

`FEATURE_AGENT_EXECUTION` remains false by default. When false, offer inspection
works while purchase creation and execution fail closed in both UI and API.
Settlement remains `mock`; no wallet, provider payment or chain transaction is
introduced by this decision.

## Consequences

- Provider/model/attestation state is visible without implying that schema
  validation proves confidential or attested inference.
- Model reasons and vendor text cannot alter exact server-owned payment fields.
- Policy activation is owner-only and explicit because a new version can stale
  outstanding proposals.
- One verified session identity cannot satisfy quorum twice; no fresh wallet
  signature or on-chain approval is claimed.
- Workspace queries are tenant-scoped and bounded to the newest 100 proposals,
  offers and purchases.
- The workflow remains demonstrable without funds because the vendor and
  settlement evidence are deterministic mocks.

## Evidence boundary

Backend tests cover invalid model/vendor fields, provider failure, policy
binding, disabled execution, exact offer revalidation, workspace evidence,
policy merging and verified-session approval routing. Browser tests cover
desktop/mobile attestation labels, adversarial prose, exact integer CFO input,
the disabled execution gate, structured offers, policy activation, quorum and
mock fulfillment.

No NEAR AI request, attestation verification, wallet signature, deployment,
blockchain transaction, external vendor request, real payment or fund movement
occurred. A live PostgreSQL-backed HTTP run of the new workspace/action routes,
manual wallet evidence, Safari/Firefox and accessibility review remain open.
