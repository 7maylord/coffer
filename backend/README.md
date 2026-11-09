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

## Deployed testnet contracts and integration status

The verified public testnet values are:

```text
NEAR_NETWORK=testnet
NEAR_TEST_TOKEN_CONTRACT_ID=ctusd.olymight.testnet
NEAR_TEST_TOKEN_CODE_HASH=9ErFRZL31aDUPy6nBfztaCySidVzZsZsoyqP5x9NoM12
```

The non-custodial policy contract is `policy.olymight.testnet`, with code hash
`EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj`. Its current 2-of-2 approver
accounts are test keys under one operator and must not be described as
production segregation of duties.

`NearPolicyContractVerifier` already pins configuration/proposal reads to one
final block and verifies the expected code hash. `NearTestnetTransferAdapter`
already constructs canonical native/ctUSD wallet actions and independently
checks testnet finality, exact signer/receiver/amount, single action, successful
receipts, ctUSD code and metadata, receiver registration, and the NEP-141 event.
It claims a transaction hash durably so it cannot be reused.

The owner-only `GET /v1/orgs/:orgId/policy-contract/deployment` endpoint checks
the configured factory and returns the active policy commitment, authorized
wallet candidates, quorum and minimum deployment deposit. The provisioner must
sign `create_policy_instance` outside the API. After finality, owner-only
`POST /v1/orgs/:orgId/policy-contract/binding` binds the instance only after
checking the factory and instance code hashes, pinned code reference, active
state, deterministic account, exact policy digest, eligible distinct approvers,
and zero instance access keys. The binding is required for later proposal
verification and is inserted once with an audit event. These endpoints need all
four `NEAR_POLICY_*` environment values from the verified release; they are off
while unset. See [factory deployment runbook](../contracts/policy-factory/DEPLOYMENT_RUNBOOK.md).
Initial binding currently requires the organization's active policy to be
version 1, matching the newly initialized contract configuration version.

The verified testnet values are `factory.olymight.testnet`, factory hash
`E39mq9jbJTMyqK82oxsGks78bw5n7JpmCxz1cC1RroLZ`, provisioner
`olymight.testnet`, and policy hash
`EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj`. They are populated in the
root `.env.example`; no private key is loaded by the API.

Policy instances are per **organization**, not per Coffer login. Creating a
Coffer account does not deploy a contract. After the owner creates an
organization, activates its first policy and verifies enough approver wallets,
`POST /v1/orgs/:orgId/policy-contract/deployment-preview` accepts the owner
controller and approver accounts and returns an exact unsigned factory call.
When executed, the configured provisioner signs and pays the gas **and** attached instance
deposit. This is the prepared sponsored route; the API does not hold the provisioner key
or broadcast the transaction. The preview rejects a pending/active instance,
unverified approvers, duplicate human owners of approver wallets, or an
unverified owner controller. The operator must recheck final state before
signing because a preview is not a reservation.

`SettlementService` and `SettlementController` still expose only the mock
lifecycle. Canonical wallet instruction and transaction-evidence endpoints,
durable attempt transitions, and verified settlement posting remain open. The
browser signs; the API never receives a wallet key or treats an unverified
callback or submitted hash as success.

Live flags stay off by default:

```text
LIVE_TRANSFERS_ENABLED=false
NEAR_TESTNET_TRANSFERS_ENABLED=false
FEATURE_NATIVE_POLICY_CONTRACT=false
```

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
cp backend/.env.example backend/.env
pnpm --dir backend install
docker compose up -d postgres redis
pnpm --dir backend prisma:generate
pnpm --dir backend prisma:migrate:deploy
pnpm --dir backend prisma:seed
pnpm --dir backend dev
```

The API and worker load `backend/.env` in development and test only. Deployed
environments must inject variables through their secret manager. The frontend
never receives the Intents partner JWT or the factory provisioner key.

## NEAR Intents (1Click)

1Click does not provide a public testnet. Keep the app in mock mode and enable
only current asset discovery and dry quotes first. For official mainnet quote
discovery, use:

```text
SETTLEMENT_MODE=mock
LIVE_TRANSFERS_ENABLED=false
NEAR_INTENTS_PROVIDER=one-click
NEAR_INTENTS_DRY_QUOTES_ENABLED=true
NEAR_INTENTS_WET_QUOTES_ENABLED=false
NEAR_INTENTS_API_KEY=<partner JWT>
```

The adapter discovers current asset IDs from `/v0/tokens` and sends amounts in
atomic units. `dry=true` obtains a preview without a deposit address. Use only
provider-returned asset IDs; the testnet `ctUSD` contract is never an Intents
asset. Leave both credential fields empty for unauthenticated development, or
set exactly one of `NEAR_INTENTS_API_KEY` (the preferred `X-API-Key` header) and
`NEAR_INTENTS_JWT` (Bearer fallback). Wet quotes require all three explicit
gates: dry quotes, wet quotes, and live transfers. Official 1Click mainnet
execution is not enabled by the testnet UI.

For the community-operated Tidepool testnet sandbox, use the following instead:

```text
SETTLEMENT_MODE=mock
LIVE_TRANSFERS_ENABLED=true
NEAR_TESTNET_TRANSFERS_ENABLED=true
NEAR_INTENTS_PROVIDER=tidepool
NEAR_INTENTS_API_URL=https://www.usetidepool.tech
NEAR_INTENTS_DRY_QUOTES_ENABLED=true
NEAR_INTENTS_WET_QUOTES_ENABLED=true
```

Coffer registers Tidepool-discovered assets as test-only, never forwards an
official 1Click API key/JWT to Tidepool, and marks its quotes/statuses
`signatureVerified: false`. Tidepool is not affiliated with NEAR or 1Click;
never send mainnet or valuable assets to it. Its current API flow is documented
at https://www.usetidepool.tech/docs/guides/first-swap.

Authenticated clients can refresh assets through
`GET /v1/settlement/intents/assets`, preview through
`POST /v1/orgs/:orgId/settlement/intents/dry-quote`, and persist an executable
quote through `POST /v1/orgs/:orgId/settlement/intents/swaps` with an
`Idempotency-Key`. The browser displays the exact NEP-141 call and asks the
verified testnet wallet to sign it. The backend independently verifies the
finalized transaction before submitting its hash to Tidepool and persisting
status observations. Provider `SUCCESS` is exposed as `UNVERIFIED_SUCCESS`
with `settlementCredited: false`; it never posts to the Coffer ledger because
destination settlement is not independently verified. All flags in the
example file remain false by default.

Tidepool quotes use `depositType=INTENTS` and `refundType=INTENTS`. The wallet
calls `ft_transfer_call` on the origin token with receiver
`verifier.tidepool-sandbox.testnet`, the exact atomic input, 100 TGas, one
yoctoNEAR, and the quote deposit address as `msg`. This avoids NEP-145 storage
registration for every fresh quote address. Existing persisted
`ORIGIN_CHAIN` quotes remain executable with their original `ft_transfer`.
An `INTENTS` refund is an internal verifier balance, not automatically a wallet
token balance.

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
