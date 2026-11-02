# Coffer backend

The Coffer backend is an independent NestJS and Prisma project. It owns the API,
worker-facing domain boundaries, database migrations, settlement adapters, and
reconciliation logic. The frontend has its own package installation and does
not share a pnpm workspace with this project.

The current implementation includes the B-01 foundation through the automated
B-11 local hardening gate. B-04 supplies
deterministic policy decisions, immutable versioned financial proposals,
distinct-human approvals tied to verified NEAR accounts, and execution-time
policy/quorum revalidation. Its optional NEAR contract verifier pins reads to a
single final block and validates the code hash, configuration, proposal digest,
expiry, and exact approver set. It only builds unsigned call descriptions; no
backend route signs or submits a blockchain transaction.

The ledger uses canonical asset IDs and integer atomic units. PostgreSQL
enforces same-tenant/same-asset relationships, nonnegative available balances,
deferred debit/credit equality, and append-only posted records. Serializable
account locks protect reservations and posting from concurrent overdrafts;
corrections create linked reversals instead of editing history.

Safe defaults are enforced at startup:

```text
SETTLEMENT_MODE=mock
LIVE_TRANSFERS_ENABLED=false
```

No backend route signs or sends a blockchain transaction.

B-08 exposes strict, tenant-scoped CFO suggestions and a bounded mock service
purchase flow. AI and vendor output are untrusted: schema and amount checks run
before persistence, a human decision is required before reservation, and agent
purchases pass through the central policy and approval service. Agent authority
includes an immutable rolling spend window. `FEATURE_AGENT_EXECUTION` and real
NEAR AI access remain disabled by default; B-08 does not claim verified private
inference.

B-09 accepts only strict synthetic payroll CSV, encrypts individual salary and
profile fields with per-batch envelope keys, binds approval to an immutable
manifest, and exposes self-only payslips plus purpose-limited redacted auditor
views. Deterministic anomaly checks are the default. The NEAR AI path fails
before sending salary data unless all model reports pass the configured
preflight verifier, and it accepts only an exact-byte `provider_tee` response
signature. The bundled report verifier is unavailable by design, so this local
build does not claim live verified private inference.

B-10 adds tenant-scoped hash-chained audit events, purpose-separated auditor
and operator permissions, settlement exception queues, aggregate operational
metrics, and an idempotent manual recheck action. Recheck queues observation of
an existing uncertain payment; it cannot create or repeat a payment. Audit
metadata is bounded and redacted at the API boundary.

## Local setup

Use Node.js 24 and pnpm 10. Install this project independently:

```bash
pnpm --dir backend install
docker compose up -d postgres redis
pnpm --dir backend prisma:generate
pnpm --dir backend prisma:migrate:deploy
pnpm --dir backend prisma:seed
pnpm --dir backend dev
```

The synthetic seed is idempotent. It creates demo roles, one issued invoice,
and one uncertain mock settlement for the operator dashboard. It does not seed
payroll ciphertext or authentication credentials.

To rebuild only an explicitly confirmed local non-system database and reseed:

```bash
CONFIRM_LOCAL_DB_RESET=yes pnpm --dir backend prisma:reset:local
```

Local defaults use PostgreSQL at `localhost:5433` and Redis at
`localhost:6379`. Environment values are validated before Nest starts. Boolean
flags accept only the literal strings `true` and `false`.

## Checks

```bash
pnpm --dir backend format:check
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend test:critical
pnpm --dir backend test:cov
pnpm --dir backend test:integration
pnpm --dir backend test:e2e
pnpm --dir backend build
pnpm --dir backend test:performance
pnpm --dir backend openapi:check
```

Integration tests require the local Docker services. The coverage gate requires
at least 80% statements, branches, functions, and lines, plus at least 90%
aggregate branch coverage across the explicitly listed P0 critical modules.
See `docs/backend-hardening.md` for the B-11 evidence and remaining independent
review requirement.

## OpenAPI

`pnpm --dir backend openapi:generate` writes the generated OpenAPI 3.1 document
to `docs/api/openapi.json`. CI runs `openapi:check` and fails when controller
metadata and the committed document differ.

Every JSON money amount is a positive base-10 integer string in the asset's
atomic units. Asset symbols are display metadata and cannot identify an asset.
