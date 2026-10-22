# Coffer

Coffer is a NEAR-oriented finance operations prototype. The current local foundation uses a Next.js frontend, a NestJS backend, PostgreSQL, Redis, and separate Rust/NEAR policy and test-token contract packages. Runtime settlement remains deliberately **mock-only** while contract-first implementation is in progress, and synthetic payroll is the only seeded payroll data.

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
pnpm build
pnpm contracts:fmt
pnpm contracts:lint
pnpm contracts:interface-test
pnpm contracts:test
pnpm contracts:check
pnpm contracts:build
```

## Mock settlement

The mock adapter supports only the explicitly fictional assets returned by `GET /v1/settlement/assets`. Create a quote with `POST /v1/orgs/:orgId/payments/quotes`, initiate it with `POST /v1/orgs/:orgId/payments` and an `Idempotency-Key`, then advance the deterministic scenario with `POST /v1/orgs/:orgId/payments/:paymentId/poll`.

Supported scenarios are `success`, `refund`, `unknown`, `partial_deposit`, `expired_quote`, `status_delay`, and `duplicate_callback`. The mock adapter rejects confidentiality claims and never signs or broadcasts a transaction.

## Safety defaults

- `SETTLEMENT_MODE=mock`
- `LIVE_TRANSFERS_ENABLED=false`
- no provider credentials in the browser or repository
- salary values are encrypted in the synthetic seed; the ephemeral seed key is discarded
- the in-memory mock adapter is for the current foundation only; PostgreSQL-backed settlement persistence and a transactional outbox are Gate G1 work

Research findings, provider assumptions, and architecture decisions are in [`docs/research-onboarding.md`](docs/research-onboarding.md), [`docs/provider-matrix.md`](docs/provider-matrix.md), and [`docs/adr/0001-local-foundation.md`](docs/adr/0001-local-foundation.md).

The selected delivery sequence and milestone gates are documented in [`docs/implementation-plan.md`](docs/implementation-plan.md). Contract-first scope and its non-custodial boundary are recorded in [`docs/adr/0002-contract-first-delivery.md`](docs/adr/0002-contract-first-delivery.md). Direct NEAR testnet settlement and the separate valueless NEP-141 test asset are recorded in [`docs/adr/0003-testnet-payment-fallback.md`](docs/adr/0003-testnet-payment-fallback.md) and [`docs/adr/0004-test-token.md`](docs/adr/0004-test-token.md).
# coffer
