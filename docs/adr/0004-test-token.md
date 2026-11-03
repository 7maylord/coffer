# ADR-0004: Separate test-only NEP-141 settlement asset

- Status: accepted
- Date: 2026-10-28
- Related: FR-PAY-003, FR-PAY-007, FR-TRE-001 through FR-TRE-003, COF-102, COF-203, T-FT-01 through T-FT-08, T-LED-05, T-PAY-01 through T-PAY-12, Gate G3

## Context

Native testnet NEAR proves wallet signing and on-chain reconciliation but does not exercise fungible-token registration, decimal handling, or NEP-141 transfer semantics. NEAR Intents has no testnet environment, so testnet NEAR and locally deployed test tokens cannot test 1Click settlement.

## Decision

Create `contracts/test-token` as an independent Rust contract generated with `cargo near new`. It implements a valueless six-decimal NEP-141 token named **Coffer Test Dollar** with symbol `ctUSD`, NEP-145 storage management, NEP-148 metadata, and standard NEP-297 events.

The contract has a bounded owner-only mint capability for synthetic test balances. It contains no policy, approval, payroll, treasury, swap, bridge, or Intents logic. It is not imported into `contracts/near-policy` and cannot be identified by symbol alone. The backend registry uses `near:testnet:nep141:<contract-account-id>` and verifies network, contract account, decimals, metadata, artifact identity, transaction actions, receipts, and events.

Mock USDC remains off-chain and supplies deterministic adverse scenarios. Native testnet NEAR and `ctUSD` supply real testnet evidence. Intents uses only current provider-returned mainnet asset IDs for discovery and dry quotes by default.

## Consequences

The test-token package adds NEP-141 and storage-registration testing work, a second WASM artifact, and a separate deployment runbook. It provides no claim about USDC reserves, price stability, liquidity, cross-chain routing, confidentiality, or Intents compatibility.

Deployment, faucet use, issuer funding, minting, registration, and transfers remain separately authorized external actions. Routine CI uses unit tests and NEAR Sandbox only.
