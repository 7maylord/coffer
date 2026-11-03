# ADR-0006: PostgreSQL settlement authority and durable delivery

- Status: accepted
- Date: 2026-10-30
- Related: ADR-004, COF-104, COF-202, FR-PAY-001/002/004-007, T-PAY-02 and T-PAY-04 through T-PAY-12, Gate G1

## Context

The deterministic mock adapter proved the payment state machine but kept quotes,
attempts, observations, idempotency keys, and posting counters in process memory.
It could not survive restart or serialize concurrent provider events. Redis was
available locally, but a queue cannot be the authority for financial state.

## Decision

PostgreSQL owns quote snapshots, payment attempts, immutable status history,
provider inbox records, settlement observations, refund facts, reconciliation
cases, posting intents, and outbox delivery state. Initiation locks the tenant,
binds the organization, operation, idempotency key, and request digest, and
persists the attempt plus its first polling event before returning.

Provider observations are untrusted. A terminal success or refund creates a
posting intent only when the controlled amount, canonical asset, recipient where
applicable, and provider verification match the stored quote. Unknown or
inconsistent evidence creates one reconciliation case and never initiates a
second spend. A unique payment-and-kind constraint limits settlement and refund
posting intents to one each.

The outbox worker claims settlement events with a recoverable PostgreSQL lease.
It publishes polling and reconciliation work to Redis, while ledger posting uses
the B-03 idempotent journal reference. A crash after journal creation is safe:
retry finds the same journal before marking the posting and outbox event complete.
Redis carries work and is not consulted to determine payment or ledger state.

## Consequences

Mock settlement state and idempotency now survive process restart. Concurrent
duplicate terminal events serialize at the payment row and produce one posting.
Delivery is at least once, so every consumer still needs inbox or idempotency
checks. The current worker has a separate runnable entry point; production
process supervision, dead-letter operations, and manual resolution UI belong to
B-10.

No provider call, wallet signing, transfer, secret, testnet transaction, or
mainnet action is enabled by this decision. `SETTLEMENT_MODE=mock` and
`LIVE_TRANSFERS_ENABLED=false` remain mandatory defaults.
