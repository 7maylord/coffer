# ADR-0001: Local foundation and provider boundaries

- Status: accepted
- Date: 2026-10-28
- Related: ADR-001 through ADR-006, COF-001, COF-002, COF-004, COF-202, Gate G0

## Context

The initial official scaffolds produced independent `frontend`, `backend`, and `contracts` projects. Coffer needs reproducible local commands, a database contract, mock settlement, and CI without implying that a live provider or optional contract is ready. The owner requires frontend and backend dependency boundaries rather than a shared pnpm workspace.

## Decision

Keep the requested top-level directory separation and make `frontend` and `backend` standalone pnpm projects. Each owns its package manifest, lockfile, and `node_modules`. The root package has no dependencies and only forwards the documented commands; `contracts` remains an independent Cargo project. Run PostgreSQL 17 and Redis 7 through Docker Compose. Use Prisma 6.19.3 for the initial tenant, invoice, settlement, idempotency, payroll, audit, and outbox schema.

The only enabled settlement provider is an in-memory deterministic mock implementing the provider-neutral lifecycle. Atomic amounts cross JSON boundaries as decimal integer strings. The adapter rejects confidentiality modes, unsupported fictional assets, expired quotes, changed idempotent requests, and unverified success. Live transfer flags remain false.

Seed only the fictional Northstar Studio organization and synthetic employees. Salary values are encrypted using an ephemeral key discarded after the seed; this is a schema/fixture, not a production key-management design.

## Consequences

Local development and CI can verify migrations and financial state semantics without credentials or funds. Frontend and backend installs can now change independently, at the cost of losing pnpm workspace linking and a single application lockfile. CI installs and caches each project separately. The in-memory adapter is not durable, so G1 must move attempts, observations, idempotency, postings, and outbox events into PostgreSQL transactions before the mock can support an end-to-end reconciled ledger claim. Redis exists locally for that worker work but is not yet an authority for money state.

No native contract deployment, 1Click call, NEAR AI call, or wallet signing is part of this decision.

Request safety: correlation IDs are server-generated UUIDs; incoming IDs are
not trusted. Error responses expose only HTTP code, generic message and the
correlation ID; exception payloads are never serialized into responses.
