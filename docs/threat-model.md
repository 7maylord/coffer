# Foundation threat model

The five highest-risk operations for the current and next Coffer milestones are:

| Risk | Attack/failure | Required control | Current state |
|---|---|---|---|
| Duplicate or uncertain settlement | Retried initiation, duplicate callback, or timeout posts money twice | Tenant-scoped idempotency digest, immutable observations, one terminal posting, reconciliation state | PostgreSQL serializes attempts/events, unique posting intents and idempotent journals prevent duplicate credits, and unknown evidence opens reconciliation |
| Tenant/payroll disclosure | An ID swap, log, export, or prompt reveals another organization or employee salary | Server-side organization and record scope, encrypted fields, redaction, audited grants | Schema is tenant-keyed and synthetic salary seed is encrypted; authz endpoints remain G1 |
| AI authority escalation | Prompt injection alters recipient, policy, approval, or payout | Model may only emit typed proposals; deterministic validation and human approval own every financial mutation | B-08 accepts only scoped allocation JSON, rejects extra destination/tool fields, records failures, and requires human approval before a ledger reservation; the NEAR AI path has no signing/payment tools and defaults off |
| Malicious agent vendor | Vendor text, URL, substituted identity, changed price, expired offer, duplicate request, or revoked agent bypasses procurement policy | Fixed service registry, strict schemas, immutable offer digest, serializable budget claim, current agent state, central policy and human approval | One in-process mock vendor is implemented; adversarial and concurrent tests pass, while external connectors and real payment remain unavailable |
| Signing/key compromise | Browser/server secret or broad key enables unauthorized transfer | User-controlled exact transaction signing, server-only credentials, restricted keys, live kill switch | No keys are accepted or stored; the testnet adapter emits exact wallet instructions and all transfer/provider flags default off |
| Provider/status spoofing | A false `SUCCESS`, stale quote, wrong route, replayed hash, or malicious callback marks an invoice paid | Current asset lookup, expiry, signed/verified evidence, independent chain/provider reconciliation, fail closed | Mock remains the only posting path. B-07 validates signed 1Click fixtures and exact finalized NEAR receipts, persists unique testnet hash claims, and does not directly post either adapter result |
| Public invoice disclosure | A guessed or leaked link exposes customer contacts, tenant metadata, adjacent invoices, or cross-invoice payments | 256-bit token, digest-only storage, single-record lookup, fixed redacted response, draft/void hiding, server-derived quote authority and attempt-to-invoice binding | API/E2E tests prove public output omits customer email, metadata, tenant/user IDs, payment IDs and token digest; quote/payment responses omit internal IDs, reject cross-invoice attempts and cannot override amount, asset or recipient |

Residual risk: routine settlement remains a deterministic mock, and the worker
has no production supervisor or manual resolution UI. Sanitized provider and RPC
fixtures prove validation behavior but do not prove current provider
availability, an actual testnet transfer, or real asset value.

NEAR AI HTTP behavior is also fixture-only. Model and gateway attestation,
exact-byte response signatures and TLS binding are not verified, so suggestions
are explicitly `UNVERIFIED` and cannot be described as private inference. Agent
fulfillment and its payment reference are simulated. Recovery for a crash
between a purchase claim and policy-proposal linkage remains operator work for
B-10, although unique claims prevent a duplicate purchase.
