# ADR-0014: Authoritative treasury split and approval UI

- **Status:** Accepted
- **Date:** 2026-11-01
- **Requirements:** J-02, J-04, FR-POL-001–003, FR-APR-001–002,
  FR-TRE-001–003, COF-301–303
- **Gate:** G4 local implementation evidence

## Context

The visual demo already showed a 50/30/20 revenue allocation, but it used local
state and could not prove where balances, policy decisions, revisions, approvals
or reservations came from. The production route must not let browser-generated
hashes, labels or AI text become authorization inputs. It must also distinguish
an internal ledger balance from wallet custody and distinguish a verified login
identity from a fresh wallet or on-chain signature.

## Decision

Canonical `/treasury` and `/approvals` use a dedicated server workflow over the
existing ledger and policy services. The browser sends only a tenant-scoped
source account, an exact atomic amount and an expiry. The backend derives the
fixed payroll/operations/partner-distributions shares, sends any atomic-unit
remainder to payroll, constructs the recipient and idempotency commitments,
creates the canonical proposal digest and binds the source ledger account into
the operation.

The workflow activates a versioned policy that permits only Mock USDC on the
internal-ledger route, requires two distinct eligible people and allows only the
fixed split commitment. A material edit creates a new proposal revision and the
policy store marks the previous revision superseded. Approval uses a NEAR
account already verified by the session's NEP-413 login proof. The UI explicitly
states that this records no fresh wallet signature or blockchain transaction.

An approved revision has no automatic external effect. `verify and reserve`
rechecks current policy, digest, expiry, membership, distinct-user quorum and
any configured final NEAR contract binding before creating an idempotent
internal ledger reservation. A failed required RPC or contract check creates no
reservation. No payment or transfer is submitted.

Treasury balances are returned from ledger accounts and labelled
`ledger-derived internal`. The current asset is a test-only mock asset and the
UI labels custody `not on-chain verified`. Empty account state remains empty;
the UI does not invent the illustrative $10,000 balance.

## Consequences

- Browser display calculations cannot authorize a proposal; the server owns the
  canonical split and digest material.
- Duplicate approval by the same user remains rejected by the database-backed
  proposal approval uniqueness rule and is also disabled in the UI.
- Reservation is safe to retry because the reference is the immutable proposal
  ID and a different payload conflicts.
- Contract explorer evidence appears only after configured contract verification.
  With no binding, the result is truthfully labelled off-chain verification.
- A fresh wallet approval signature and deployed contract write flow remain
  separate work. They must not be inferred from the verified-session approval.

## Evidence boundary

Service tests cover deterministic remainder assignment, server-derived material,
insufficient funds, final verification ordering and no reservation after an RPC
failure. Browser tests cover desktop/mobile truthful labels, exact input,
duplicate-person quorum, revision invalidation, expiry, policy denial and RPC
failure. No live wallet, deployed contract, provider, transfer or fund movement
was used. PostgreSQL-backed HTTP integration for these new wrapper routes and a
real configured contract-binding browser run remain unverified.
