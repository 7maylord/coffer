# ADR-0016: Authoritative payroll and operations UI boundaries

- **Status:** Accepted
- **Date:** 2026-11-02
- **Requirements:** J-05, FR-PRV-001–005, FR-AUD-003, COF-501/502
- **Gate:** F-05/F-06 local implementation evidence; G4 remains incomplete

## Context

The visual demo already contained payroll and activity screens, while the
backend already enforced encrypted synthetic payroll, self-scoped payslips,
append-only audit events and safe reconciliation actions. Canonical routes
needed to expose those authorities without converting display masking into a
privacy claim or an operator click into payment success.

NEAR AI Cloud can support private, verifiable inference, but the repository's
strict payroll path may claim this only after current model/TEE attestation and
exact response-signature verification. NEAR describes off-chain computation as
trusted only when hardware attestation proves the code and signed result
([NEAR AI and Cloud Services](https://docs.near.org/getting-started/hackathons#ai-and-cloud-services),
[Off-chain Compute](https://docs.near.org/primitives/off-chain-compute/what-is)).

## Decision

Canonical `/payroll` branches by server-returned organization role. Owners and
finance administrators use bounded tenant batch summaries and the existing
permission-gated detail/import/analysis/approval APIs. Batch discovery returns
no individual plaintext. Approval sends only the manifest digest and version
already returned by the authorized detail response.

Employees use a separate bounded `/v1/me/payslips` collection. Its database
query filters by authenticated user and active employee membership before
decryption, and every returned line records a sensitive self-read. It does not
accept an organization ID or employee ID from the browser.

Deterministic analysis is labeled `NOT_REQUESTED`; it is not private inference.
The private option accepts a result only through the existing strict backend
verification gate. With private AI disabled or unavailable, the UI shows no
finding and makes no attestation claim. Payroll values remain in React memory
and authorized response content, not URLs, browser storage, telemetry or logs.

Canonical `/activity` combines the existing tenant operations dashboard,
metrics and redacted audit page. It shows state and identifiers required for
operations but omits amounts, recipients and provider payloads. The only
operator mutation is the existing idempotent recheck of an open unknown case.
Recheck queues observation through the outbox; it does not change payment
status, retry a spend or post a ledger entry. Auditors receive read-only UI.

## Consequences

- Finance batch discovery is bounded to 100 summaries; individual plaintext
  still requires the existing audited detail permission.
- Employee collection reads remain self-scoped even when a line ID is unknown
  to the browser.
- Private-AI unavailability is visible and fail-closed; no fallback is labeled
  private.
- Audit integrity, queue state and reconciliation uncertainty remain visible
  without exposing financial or payroll payloads.
- Manual recheck retains CSRF, tenant permission and idempotency boundaries and
  cannot manufacture settlement success.

## Evidence boundary

Unit tests cover list delegation, self-decryption audit and API contracts.
PostgreSQL integration and HTTP e2e tests cover encryption, tenant/self scope,
disabled private AI, manifest approval, redaction and reconciliation authority.
Desktop/mobile browser tests cover finance and employee payroll paths,
deterministic and unavailable-private labels, exact approval binding, all
operator state groups, integrity evidence and auditor denial.

No real payroll, NEAR AI call, TEE attestation, wallet signature, live provider
observation, deployment, blockchain transaction, email or fund movement was
performed. Auditor payroll export remains API-only; accessibility and
cross-browser release review remain F-07 work.
