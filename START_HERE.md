# Coffer specification bundle — Start here

This bundle provides the **requirements and coding-agent instructions**, not an implemented application.

1. Read `COFFER_PRD_TRD.md` end to end. Sections 9–10 are the developer setup and the actionable milestone plan.
2. Place all files at the root of the intended **Coffer code repository**.
3. Install Codex, Claude Code, pnpm, Docker and (if native contracts are desired) Rust/NEAR CLI according to section 9.
4. Configure `nearDocs` MCP in Codex (`codex mcp add nearDocs --url https://docs.near.org/mcp`). Claude Code can read the provided `.mcp.json` after workspace approval.
5. Install `near/agent-skills` in both agents; verify skills are available.
6. Ask either agent to perform the **research-only onboarding prompt** in section 9.8, then authorize E0/G0 scaffolding.
7. Use `AGENTS.md` for Codex and `CLAUDE.md` (imports `AGENTS.md`) for Claude Code so both follow the same scope and security gates.
8. Start with **mock settlement** and synthetic payroll data. Treat real mainnet transfers and deployment as separate explicitly approved tasks.

The `pnpm` app scripts, Docker Compose file and actual application source described by the PRD must be created by the coding agents; they are **not** included here.

## Local completion record

Status: **complete for the owner-approved local foundation scope on 2026-10-28**.

- [x] Required PRD sections, shared instructions, official NEAR skills, NEAR Docs MCP results, Intents docs and NEAR AI verification docs reviewed.
- [x] `frontend`, `backend` and `contracts` scaffolds retained at the workspace root.
- [x] Node/pnpm, Docker, Rust, `cargo-near`, Codex MCP and NEAR skills verified for the active Codex workflow.
- [x] Research onboarding preserved in `docs/research-onboarding.md`, `docs/provider-matrix.md`, `docs/threat-model.md` and `docs/adr/0001-local-foundation.md`.
- [x] Independent frontend and backend pnpm projects, per-project pinned lockfiles, split CI jobs, runtime safety defaults and reproducible README created. The root package only forwards commands and has no dependencies.
- [x] Healthy local PostgreSQL and Redis services configured through Docker Compose.
- [x] Prisma schema and migration applied; encrypted synthetic Northstar payroll fixtures seeded.
- [x] Mock settlement API implements deterministic lifecycle, idempotency, expiry, refund, underfunded, unknown/reconciliation and duplicate-event behavior with no live signing or transfers.
- [x] Formatting, lint, strict typecheck, unit/coverage, database integration, API E2E, production builds, dependency audit and contract checks completed.

Per the owner's instruction, Git repository initialization and Claude MCP/onboarding verification are explicitly outside this completion record. This record covers `START_HERE.md` setup and the approved mock foundation; it does not claim the full MVP checklist in PRD section 16.
