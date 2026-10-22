# Coffer — Shared Instructions for Coding Agents

**Mandatory source of truth:** Read `COFFER_PRD_TRD.md` (especially sections 0, 2–5, 7–10, 13 and 16) before proposing or writing implementation code. Read official NEAR skill files and use NEAR Docs MCP for protocol-specific details. Treat provider docs as changing; cite the current page when selecting APIs.

## Required workflow
1. Examine actual repo, branches, scripts and environment before acting. Never assume specified project scripts exist until you create/verify them.
2. For each change name the related `FR-*`, `T-*`, `COF-*`, `ADR-*` and milestone gate. Give a short implementation plan and request authorization before work that affects funds/secrets/deployments.
3. Implement tests first or alongside code, in small reviewable slices. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, integration and e2e tests relevant to the change. Never falsely claim passing tests.
4. Use TypeScript strict mode and runtime validation. Keep controllers thin, domain pure, exact money integer arithmetic, provider adapters behind typed interfaces, DB migrations transactional.
5. Maintain tenant isolation, audited immutable approvals, deterministic policy evaluation, proper money ledger, idempotency and reconciliation. Treat AI/provider/user input as untrusted.
6. No unrestricted agent signing and no direct payments through LLM output. All payment instructions must be canonical, policy checked, human/authorized signer approved, and live execution manually enabled.
7. Defaults: `SETTLEMENT_MODE=mock`, `LIVE_TRANSFERS_ENABLED=false`; don't fund real wallets, use mainnet, post to X, publish repos, send real email, or deploy without explicit human approval.
8. Do not put payroll PII, wallet keys, access tokens or vendor credentials in code, fixtures, browser bundles, Git or logs. Only synthetic payroll in demo. Private inference must be verified before claiming it.
9. Native NEAR Rust/WASM contracts are optional; Aurora/EVM is different. NEAR cross-contract promises are async and may require compensation. Verify current docs for near-sdk, CLI, Intents, AI and wallet SDK usage.
10. Finish by listing files changed, tests run (or not run), actual outputs, provider assumptions, security/privacy implications and next smallest task. Update ADRs and OpenAPI.

## Architecture defaults
- pnpm monorepo: Next.js `apps/web`, NestJS `apps/api` and `apps/worker`, shared `packages/*`, PostgreSQL + Redis, optional Rust `contracts/near-policy`.
- For production-minded code: strict tenant authorization, idempotent external effects, transactional outbox, versioned proposals, integer token amounts, correlation/audit IDs, fail-closed security, no AI tool with authority to sign/transfer.
- P0 must be hackathon-completable but architected for P2 hardening. See scope matrix rather than implementing everything at once.

## First research task
Query official docs MCP `https://docs.near.org/mcp` and `https://docs.near.org/llms.txt`; read `near-intents`, `near-ai-cloud`, `near-dapp`, `near-api-js`, `near-smart-contracts`, and `near-kit` skill content as relevant. Document SDK versions, quote/status schema, no-1Click-testnet caveat, confidential-payment visibility, and NEAR AI attestation requirements before integration.

## Forbidden shortcuts
Never use JavaScript floating point for money; never accept payment “success” from an unverified callback; never retry unknown external spends blindly; never claim private payroll by hiding values in UI; never let an AI grant itself permissions or change approval hashes; never assume NEAR function-call keys authorize arbitrary Ethereum transactions; never implement a new contract just to claim a track.
