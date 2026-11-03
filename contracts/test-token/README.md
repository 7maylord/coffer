# Coffer Test Dollar (`ctUSD`)

This independent contract implements a test-only six-decimal NEP-141 fungible
token for NEAR Sandbox and testnet settlement evidence. It has no monetary
value, is not USDC, and is not supported by NEAR Intents unless a provider
independently lists its exact contract asset ID.

Implemented behavior:

- NEP-141 `ft_transfer`, `ft_transfer_call`, balance, supply, and private resolver;
- NEP-145 storage registration, withdrawal, and unregistration;
- NEP-148 metadata: `Coffer Test Dollar`, `ctUSD`, 6 decimals;
- NEP-297 standard mint, transfer, and burn events;
- issuer-only, one-yocto-protected minting to registered accounts;
- immutable configured maximum supply;
- bounded mint/transfer memos and transfer-call messages;
- explicit `test_only: true` configuration view.

The contract has no policy, payroll, invoice, treasury, bridge, swap, Intents,
upgrade, or arbitrary execution method. Its canonical registry identity is
`near:testnet:nep141:<contract-account-id>`; the symbol never identifies it.

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo check --target wasm32-unknown-unknown --locked
cargo near build non-reproducible-wasm --locked
```

`ARTIFACTS.md` records the latest local review build. `DEPLOYMENT_RUNBOOK.md`
contains a non-executed, approval-gated testnet procedure. Unit implementation
for C-08 is complete locally. C-09 has passing local Sandbox registration,
unauthorized-mint, transfer, resolver-refund, positive-balance unregistration
denial, forced burn/unregistration, and zero-balance unregistration evidence.
An exact registration-refund receipt assertion also passes. The reproducible
release artifact remains open.

No deployment, faucet, registration, mint, or transfer is part of the default
commands.
