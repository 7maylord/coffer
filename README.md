# Coffer

Coffer is a NEAR-oriented finance operations prototype. The current foundation uses a Next.js frontend, a NestJS backend, PostgreSQL, Redis, and separate Rust/NEAR policy, policy-factory, and test-token contract packages. Reproducible policy, factory, and valueless `ctUSD` contracts are deployed on NEAR testnet, while application settlement still defaults to **mock-only** until the wallet-signing and backend-verification path is integrated. Synthetic payroll is the only permitted demo payroll data.

## Requirements

- Node.js 24.15.0 (`nvm use` reads `.nvmrc`)
- pnpm 10.25.0
- Docker with Compose
- Rust 1.93.1 and `cargo-near` 0.22.0 for the contract packages

## Start locally

```bash
nvm use
corepack enable
cp .env.example .env
cp .env.example backend/.env
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
optional and needs its two public client identifiers in `frontend/.env.local`.
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
   and NEP-141 event before posting the ledger or marking an invoice paid; and
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

Research findings, provider assumptions, and architecture decisions are in [`docs/research-onboarding.md`](docs/research-onboarding.md), [`docs/provider-matrix.md`](docs/provider-matrix.md), and [`docs/adr/0001-local-foundation.md`](docs/adr/0001-local-foundation.md).

The selected delivery sequence and milestone gates are documented in [`docs/implementation-plan.md`](docs/implementation-plan.md). Contract-first scope and its non-custodial boundary are recorded in [`docs/adr/0002-contract-first-delivery.md`](docs/adr/0002-contract-first-delivery.md). Direct NEAR testnet settlement and the separate valueless NEP-141 test asset are recorded in [`docs/adr/0003-testnet-payment-fallback.md`](docs/adr/0003-testnet-payment-fallback.md) and [`docs/adr/0004-test-token.md`](docs/adr/0004-test-token.md).
# coffer
