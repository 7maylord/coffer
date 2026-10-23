# Coffer research onboarding

Research checkpoint: 2026-10-28. This record covers the Codex onboarding requested by `COFFER_PRD_TRD.md` section 9.8. Claude onboarding was explicitly excluded by the owner for this local milestone.

## Current dependency matrix

| Component | Selected/verified version | Role | Official source |
|---|---:|---|---|
| Node.js | 24.15.0 | Workspace runtime; selected because the generated frontend requires `^22.22.2` or `>=24` | https://nodejs.org/en/download |
| pnpm | 10.25.0 | Root workspace and frozen lockfile | https://pnpm.io/installation |
| Next.js | 16.4.3 | `frontend` | https://nextjs.org/docs |
| NestJS | 12.2.0 | `backend` API | https://docs.nestjs.com/ |
| Prisma | 6.19.3 | PostgreSQL schema, migration, and synthetic seed | https://www.prisma.io/docs/orm |
| PostgreSQL | 17 Alpine image | Local relational store | https://www.postgresql.org/docs/17/ |
| Redis | 7 Alpine image | Local queue/cache dependency reserved for G1 worker work | https://redis.io/docs/latest/ |
| `near-api-js` | 7.4.0 | Frontend RPC helpers | https://github.com/near/near-api-js |
| `@hot-labs/near-connect` | 0.11.4 | Generated wallet connector | https://docs.near.org/tools/near-connect |
| `near-sdk` | 5.29.1 resolved | Optional Rust/WASM contract scaffold | https://docs.rs/near-sdk/latest/near_sdk/ |
| Rust / Cargo | 1.93.1 | Contract compiler and tests | https://www.rust-lang.org/tools/install |
| `cargo-near` | 0.22.0 | NEAR contract check/build tooling | https://github.com/near/cargo-near |
| NEAR CLI-RS | installed locally; network use not required by this milestone | Account/contract operator CLI | https://docs.near.org/tools/near-cli |
| NEAR Docs MCP | `https://docs.near.org/mcp` | Current protocol documentation retrieval | https://docs.near.org/getting-started/tools-for-ai |

Versions above are the selected lockfile/tool versions, not claims about future latest releases. Re-run the provider preflight before any live integration.

## Verified protocol and provider findings

- Native NEAR contracts execute as WASM and commonly use Rust/near-sdk. Cross-contract calls and callbacks are separate asynchronous receipts. A downstream failure does not roll back an earlier successful receipt, so pending state, private callbacks, bounded result parsing, and explicit compensation/refund handling are required. Sources: https://docs.near.org/smart-contracts/anatomy/crosscontract and https://docs.near.org/smart-contracts/security/checklist.
- Contract state consumes staked storage. State growth needs explicit bounds and payer/refund rules. Source: https://docs.near.org/protocol/storage/storage-staking.
- NEAR accounts may hold full-access and restricted function-call keys. A function-call key is scoped to a receiver, methods, and allowance; it is not permission to sign arbitrary EVM transactions. Source: https://docs.near.org/protocol/accounts-contracts/access-keys.
- Wallet presence is not backend authentication. Use a fresh NEP-413 challenge bound to recipient/domain, nonce, account/network, and expiry, then verify and consume it server-side. Source: https://docs.near.org/web3-apps/tutorials/wallet-login.
- 1Click integration must discover current `assetId` values, preview with a dry quote, create an executable quote, accept a user-originated deposit, optionally submit the deposit hash, and poll status. `SUCCESS`, `FAILED`, `REFUNDED`, and `INCOMPLETE_DEPOSIT` are distinct outcomes. A quote is not settlement evidence. Sources: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request and https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status.
- 1Click does not provide a public testnet path for realistic settlement; any future provider experiment needs an approved small mainnet transfer. This milestone performs no quote or transfer. Supported routes must be queried at runtime. Source: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/going-live.
- Confidential swaps are capability- and route-dependent. They can reduce linkage between deposit and withdrawal, but they do not make destination-chain transfers invisible. Source: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.
- NEAR AI Cloud uses an OpenAI-compatible API, but a privacy claim requires verification. The implementation must request fresh attestation evidence, verify nonce/quote/signer bindings and approved measurements, and verify response signatures over the exact bytes. Unavailable evidence must fail closed in strict mode. Sources: https://docs.near.ai/cloud/verification/cloud-api/model-attestations, https://docs.near.ai/cloud/verification/reference/quote-nonce-signer, and https://docs.near.ai/cloud/verification/cloud-api/response-signatures.

## G0 then G1 implementation plan

G0 establishes the root workspace, pinned runtime, Docker services, Prisma schema/migration, synthetic-only seed, runtime safety defaults, CI, API documentation, and test commands. The current slice implements these items while keeping the user's `frontend`, `backend`, and `contracts` directory separation.

G1 should replace the in-memory mock repository with PostgreSQL repositories, introduce the transactional outbox and Redis/BullMQ worker, enforce organization authorization at every repository call, implement exact-money and double-entry ledger invariants, and run concurrency tests against PostgreSQL. The mock adapter interface and canonical state names should remain stable while persistence moves underneath it.

## Unknowns requiring credentials or human decisions

- Authentication choice: email/OAuth first or NEP-413 wallet challenge first.
- The approved source chain/asset, destination chain/asset, recipient, refund path, minimum amount, and legal jurisdiction for a future 1Click experiment.
- 1Click partner JWT availability, quotas, pricing, and supported route at integration time.
- NEAR AI Cloud API key, approved model from the live catalog, acceptable attestation measurements, quotas, and strict-mode fallback copy.
- Production hosting, KMS/secrets manager, email provider, monitoring, retention, and compliance owner.
- Whether the optional native contract enforces anything that cannot safely remain off-chain. No contract deployment is justified yet.

## Differences from common Ethereum assumptions

1. NEAR named and implicit accounts can hold multiple access keys; restricted function-call keys are receiver/method/allowance scoped and do not map to a single EOA private key model.
2. Cross-contract work is asynchronous receipt execution. Failure in a later receipt does not atomically revert earlier receipts, so compensation and callback safety are application concerns.
3. Contract storage requires staking and state-growth controls, rather than only paying transaction gas for an unbounded mapping write.
4. NEP-141/NEP-171 registration and transfer behavior must be read from those standards; ERC-20/ERC-721 assumptions cannot be copied directly.
5. Aurora is an EVM environment and is separate from native NEAR Rust/WASM contracts, accounts, and RPC behavior.

## Research outcome

The safe local baseline is mock settlement, exact integer amount strings, synthetic data, no provider secrets, and no live execution. The next implementation boundary is G1 persistence and tenancy; live 1Click and verified NEAR AI remain separately gated work.
