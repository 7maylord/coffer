# Backend hardening gate

Status: automated B-11 gate implemented locally; independent security review is
still required before release.

Related requirements: COF-602, PRD section 8, Gate B0, and release Gates G0,
G1, G2, and G4. This gate does not enable live transfers, provider credentials,
mainnet, contract deployment, or server-side signing.

## Automated evidence

Run these commands with Node.js 24 and the local PostgreSQL and Redis services:

```bash
pnpm --dir backend format:check
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend test:critical
pnpm --dir backend test:cov
pnpm --dir backend test:integration
pnpm --dir backend test:e2e
pnpm --dir backend openapi:check
pnpm --dir backend build
pnpm --dir backend test:performance
pnpm --dir backend audit --audit-level high
node scripts/security-scan.mjs
```

`test:critical` fails if any required PRD test ID from T-ID-01 through T-ID-08,
T-LED-01 through T-LED-07, T-POL-01 through T-POL-06, T-AI-01 through
T-AI-05, T-PAY-01 through T-PAY-12, T-PRV-01 through T-PRV-10, or T-AGT-01
through T-AGT-06 is absent from executable test sources.

`test:cov` keeps the global 80% thresholds and additionally fails below 90%
aggregate branch coverage across the P0 critical authorization, exact-money,
asset, deterministic-policy, proposal-digest, and mock-settlement mapping
modules. Experimental testnet and 1Click adapters remain covered by their
provider contract tests and are disabled by default.

`test:performance` starts the built API on a temporary loopback port and sends
250 liveness requests at concurrency 25. The smoke fails on any invalid
response, throughput below 20 requests/second, or p95 latency above 1,000 ms.
Those are CI regression bounds for the unauthenticated liveness path, not a
production SLO or capacity claim.

The integration suite provides the resilience and concurrency evidence: 100
duplicate settlement observations result in one posting; uncertain outcomes do
not create another payment; quote and idempotency state survives a service
restart; durable outbox work is the source of truth when Redis is unavailable;
concurrent reservations cannot exceed funds; and duplicate refunds post once.

CI applies migrations to an empty PostgreSQL service, seeds only synthetic
fixtures, checks generated OpenAPI, scans credential markers, runs type-aware
static analysis through the linter, audits production dependencies, and runs
the full backend suites. A local upgrade migration must also pass before a
schema change is marked complete.

## Manual release evidence

An independent reviewer must inspect tenant authorization, payment and ledger
invariants, worker recovery, provider boundaries, payroll disclosure, and the
audit chain. Record findings and disposition without secrets or payroll PII.
Any unresolved critical or high finding blocks release. Penetration testing,
backup/restore drills, DAST, external audit archival, and production SLO/load
testing remain production hardening work under PRD Phase P2-A.
