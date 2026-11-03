# ADR-0011: Tenant audit chain and safe operator reconciliation

- Status: accepted for the local P0 slice
- Date: 2026-10-30
- Related: FR-AUD-001-003, T-ID-05/07, Gates G2 and G4, B-10

## Context

Coffer already retained payment histories, outbox jobs, policy decisions and
selected payroll audit events. Those records were spread across tables, audit
rows had no integrity chain, and an operator had no bounded API for uncertain
payments. A generic status override would be unsafe because it could turn an
unverified provider result into a ledger credit or cause a duplicate spend.

## Decision

Every organization audit event receives a monotonically increasing sequence,
previous-event hash, SHA-256 event hash, correlation ID and trace ID. A
PostgreSQL advisory transaction lock serializes insertion per organization.
The hash binds the event identity, tenant, sequence, previous hash, actor,
type, entity, correlation/trace values, metadata and timestamp. Database
triggers reject updates and deletes. The only bypass is a transaction-local
setting used by automated test cleanup; the local reset command rebuilds the
database instead of editing history.

Controlled database triggers cover membership permission changes, financial
and agent proposals, approvals, policy allow/deny decisions, CFO decisions,
payment attempts and transitions, and reconciliation case changes. Payroll
confidential reads, access denials, approvals and attestation outcomes continue
to use their explicit application events. Audit API metadata is recursively
redacted and bounded before it leaves the server. Audit reads are limited to
owners and auditors; finance cannot read the audit stream.

The operator dashboard returns tenant-scoped queued outbox work, pending
payments, payments stale for more than five minutes, open reconciliation cases,
refunds and completed settlements. Aggregate metrics expose counts and the
oldest queued timestamp without recipients, amounts, provider payloads or
payroll fields.

The only manual action in B-10 is `RECHECK_EXISTING_PAYMENT`. It requires a
finance/owner role, CSRF proof and an organization-scoped idempotency key. It
queues reconciliation for the existing payment and records a chained audit
event. It cannot create a quote, payment attempt, ledger posting, provider
deposit or transfer. An uncertain result remains uncertain until independently
verified evidence enters the normal settlement state machine.

The synthetic seed is idempotent and creates role accounts, an issued invoice,
and one uncertain mock payment. It stores no credentials or payroll PII.
Encrypted payroll remains an authenticated API import so its data key is bound
to the configured application encryption key. The reset script parses and
restricts the database URL to a local non-system database, refuses production,
requires explicit confirmation, reapplies migrations and runs the seed.

## Consequences

- Hash verification detects field changes, gaps and reordered events, while
  database triggers prevent normal application mutation.
- This is database-local integrity evidence, not public-chain notarization or
  protection from a PostgreSQL superuser who can disable triggers.
- Alerts, external immutable archives, retention/legal holds, backup drills and
  incident automation remain FR-AUD-004 production work.
- No B-10 endpoint signs, broadcasts, retries a debit, or marks a payment
  settled manually.
