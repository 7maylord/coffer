# Coffer

Coffer is an AI-native financial operating system for businesses. It turns the
fragmented work of collecting revenue, planning treasury, paying a team, and
moving value across chains into one governed operating loop:

**earn → verify → analyze → constrain → approve → pay → reconcile.**

An incoming invoice payment can create a finance-agent run. Coffer’s AI CFO
reviews only the authorized financial evidence and returns a typed treasury or
operational proposal. Deterministic policy then checks exact integer amounts,
budgets, recipient allowlists, approval quorum, and expiry before an authorized
person can sign an external transaction. AI never receives a wallet key, cannot
change policy, cannot approve its own proposal, and cannot move money by itself.

## Why NEAR

Coffer uses NEAR as the trust layer for an AI-native business:

- **NEAR wallets and NEP-413 authentication** give each business user a
  cryptographic identity and retain user-controlled signing for consequential
  actions.
- **NEAR AI Cloud powers the AI CFO**: it produces constrained, schema-checked
  financial recommendations from a minimal authorized context. Coffer verifies
  the configured provider-TEE evidence and approved deployment identity before
  accepting an inference result; an AI recommendation is still never payment
  authority.
- **NEAR policy contracts** bind immutable proposal digests and distinct
  approvers. A factory creates an isolated policy instance for each business,
  without placing treasury balances, salary records, or keys on-chain.
- **NEAR Intents** is Coffer’s cross-chain execution interface: current asset
  discovery, quoted outcomes, deposit instructions, status tracking, and
  reconciliation are kept behind a typed settlement adapter.

The result is autonomy in operations—not autonomous custody. Coffer helps a
business act faster while preserving a clear, auditable human and policy
boundary around money.

## What is in this repository

| Area | What it does |
| --- | --- |
| `frontend/` | Next.js workspace for invoice, treasury, payroll, AI CFO, policy, and audit workflows. |
| `backend/` | NestJS API, tenant-scoped ledger, deterministic policy engine, reconciliation, API-owned outbox processing, and provider adapters. |
| `contracts/` | Rust NEAR policy, per-business policy factory, and a valueless test-token package. |
| `docs/` | Architecture decisions, API contract, runbooks, demo narrative, evidence, and submission material. |

The repository includes reproducible policy, factory, and valueless `ctUSD`
contracts deployed on NEAR testnet. The documented settlement proof verifies
wallet-signed testnet actions and final chain evidence before an invoice or
ledger can be credited. Demo payroll data is synthetic.

## Requirements

- Node.js 24.22.1 (`nvm use` reads `.nvmrc`)
- pnpm 10.25.0
- Docker with Compose
- Rust 1.93.1 and `cargo-near` 0.22.0 for the contract packages

## Run locally

```bash
nvm use
corepack enable
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
pnpm --dir frontend install --frozen-lockfile
pnpm --dir backend install --frozen-lockfile
docker compose up -d postgres redis
pnpm db:migrate:deploy
pnpm db:seed:synthetic
pnpm dev
```

Open the frontend at `http://localhost:3000` and the API at
`http://localhost:4000`. `/demo/overview` is the public synthetic demo;
`/overview` starts the NEAR testnet wallet-authenticated workspace. Privy is
optional and needs only `NEXT_PUBLIC_PRIVY_APP_ID` in `frontend/.env.local`.
The versioned API contract is `docs/api/openapi.json`.

Local infrastructure uses PostgreSQL on port `5433` and Redis on `6379` by default. Both ports can be changed through `.env`.

`frontend` and `backend` are independent pnpm projects. Each has its own `package.json`, `pnpm-lock.yaml`, and `node_modules`; there is no root pnpm workspace and no root dependency installation. The root `package.json` only forwards convenience commands to the two projects. Run one app alone with `pnpm dev:frontend` or `pnpm dev:backend`.

## Verify

```bash
pnpm --dir frontend install --frozen-lockfile
pnpm --dir backend install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:fullstack
pnpm build
pnpm contracts:fmt
pnpm contracts:lint
pnpm contracts:interface-test
pnpm contracts:test
pnpm contracts:check
pnpm contracts:build
```

`test:e2e:fullstack` starts the real frontend and backend on loopback, creates
an isolated synthetic owner session in the local database, and proves J-01
from invoice creation through mock settlement and reconciliation. It requires
the migrated local PostgreSQL and Redis services; it never opens a wallet or
moves testnet/mainnet funds.

## Invite employees

1. Sign in as the workspace owner and open **Settings**.
2. Enter the employee's exact verified NEAR account and create the invitation.
3. Send the displayed single-use link only to that employee. It expires after
   24 hours; its secret stays in the URL fragment rather than server logs.
4. The employee opens the link, signs in with the targeted wallet, and accepts.
   Another wallet, an expired link, or a reused link is rejected.
5. The owner can remove any non-owner member from the same Settings page.

There is no email delivery provider yet. Coffer returns the link once and stores
only its SHA-256 digest. The employee role exposes only the self-scoped payroll
surface; it cannot import, approve, or execute payroll.

## NEAR testnet deployment

| Contract | Account | Reproducible NEAR code hash |
|---|---|---|
| Policy commitments | `policy.olymight.testnet` | `EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj` |
| Per-business policy factory | `factory.olymight.testnet` | `E39mq9jbJTMyqK82oxsGks78bw5n7JpmCxz1cC1RroLZ` |
| Valueless test token | `ctusd.olymight.testnet` | `9ErFRZL31aDUPy6nBfztaCySidVzZsZsoyqP5x9NoM12` |

The policy contract is configured with a 2-of-2 **test-key** quorum using
`olymight.testnet` and `olumight.testnet`. Both keys have one operator, so this
tests distinct cryptographic approvals but is not production segregation of
duties. The token's canonical identity is
`near:testnet:nep141:ctusd.olymight.testnet`; 10,000 ctUSD were minted and a
1 ctUSD registration/transfer smoke test succeeded. ctUSD has no monetary value
and is not USDC or a NEAR Intents asset.

A second, deliberately minimal transfer of one atomic ctUSD unit was finalized
in testnet transaction
[`4J4xcE7pCYZGMy29zBGUVehpnDQyi6Ft7KxrXXKZ5dWn`](https://explorer.testnet.near.org/transactions/4J4xcE7pCYZGMy29zBGUVehpnDQyi6Ft7KxrXXKZ5dWn).
Coffer independently verified its exact action, receipts and NEP-297 event and
stored immutable evidence. This is direct-adapter proof, not a completed
browser payroll payout.

Deployment transactions and byte-for-byte artifact verification are recorded
in [`contracts/near-policy/ARTIFACTS.md`](contracts/near-policy/ARTIFACTS.md),
[`contracts/policy-factory/ARTIFACTS.md`](contracts/policy-factory/ARTIFACTS.md),
and [`contracts/test-token/ARTIFACTS.md`](contracts/test-token/ARTIFACTS.md).

## Next: first per-business instance

The backend exposes owner-only preparation, sponsored-call preview, and verified
binding for the deployed factory. It does not hold the provisioner key or
broadcast transactions. The next testnet slice is:

1. create a synthetic business, activate its first policy, and verify the two
   approver wallets;
2. request its canonical deployment preview, manually sign it as the scoped
   provisioner, wait for `Active`, and bind the locked instance;
3. expose an idempotent API that returns a canonical native-NEAR or ctUSD wallet
   transaction without receiving a private key;
4. let the frontend wallet sign and broadcast that exact transaction;
5. submit only its transaction hash to the backend, which independently checks
   finality, signer, receiver, amount, token code/metadata, action, receipts,
   and NEP-141 event before posting the ledger or marking an invoice paid (the
   direct invoice flow now implements this step); and
6. add API and browser E2E coverage for success, mismatch, replay, unknown RPC
   status, unregistered receiver, and failed receipts.

Keep `LIVE_TRANSFERS_ENABLED=false` and
`NEAR_TESTNET_TRANSFERS_ENABLED=false` outside the short, explicitly reviewed
test window. The public contract identifiers in `.env.example` are not secrets.

## Mock settlement

The mock adapter supports only the explicitly fictional assets returned by `GET /v1/settlement/assets`. Create a quote with `POST /v1/orgs/:orgId/payments/quotes`, initiate it with `POST /v1/orgs/:orgId/payments` and an `Idempotency-Key`, then advance the deterministic scenario with `POST /v1/orgs/:orgId/payments/:paymentId/poll`.

Supported scenarios are `success`, `refund`, `unknown`, `partial_deposit`, `expired_quote`, `status_delay`, and `duplicate_callback`. The mock adapter rejects confidentiality claims and never signs or broadcasts a transaction.

## Safety defaults

- `SETTLEMENT_MODE=mock`
- `LIVE_TRANSFERS_ENABLED=false`
- `NEAR_TESTNET_TRANSFERS_ENABLED=false`
- no provider credentials in the browser or repository
- salary values are encrypted in the synthetic seed; the ephemeral seed key is discarded
- PostgreSQL settlement persistence, the transactional outbox, and reconciliation are authoritative; wallet or frontend success text is never settlement evidence

The [documentation index](docs/README.md) links the product plan, provider
matrix, architecture decisions, evidence, pitch, and submission material.

The selected delivery sequence and milestone gates are documented in [`docs/implementation-plan.md`](docs/implementation-plan.md). Contract-first scope and its non-custodial boundary are recorded in [`docs/adr/0002-contract-first-delivery.md`](docs/adr/0002-contract-first-delivery.md). Direct NEAR testnet settlement and the separate valueless NEP-141 test asset are recorded in [`docs/adr/0003-testnet-payment-fallback.md`](docs/adr/0003-testnet-payment-fallback.md) and [`docs/adr/0004-test-token.md`](docs/adr/0004-test-token.md).

## Hackathon, provenance, and license

Coffer was built for **NEAR Hackathon 2026**. The project’s core product,
frontend, API, contracts, and integration work are in this repository. The
initial repository foundation was committed on October 22, 2026; the complete
commit history is available for review. We use open-source libraries and
developer AI assistance in the normal course of development; all project source
and integration code is reviewable here.

This project is available under the [MIT License](LICENSE). The NEAR Hackathon
rules permit any license and specifically identify MIT as acceptable; the
repository must remain public through judging. See [HACKATHON.md](HACKATHON.md)
and the [submission checklist](docs/submission-checklist.md) for the remaining
owner-controlled submission checks.

## Scope and safety

Coffer is non-custodial: the API does not retain user wallet keys and no AI
output can create an unrestricted transfer. Network execution, provider
credentials, and production rollout remain deliberately gated through
environment configuration and human authorization. See the documented
provider boundaries in [docs/provider-matrix.md](docs/provider-matrix.md) and
the technical requirements in [COFFER_PRD_TRD.md](COFFER_PRD_TRD.md).
