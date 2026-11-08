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

The reproducible contract is deployed at `ctusd.olymight.testnet`; its canonical
asset ID is `near:testnet:nep141:ctusd.olymight.testnet` and its NEAR code hash
is `9ErFRZL31aDUPy6nBfztaCySidVzZsZsoyqP5x9NoM12`. The immutable issuer is
`olymight.testnet`, the maximum supply is 1,000,000 ctUSD, and 10,000 ctUSD are
currently minted. A verified smoke transfer left 9,999 ctUSD with
`olymight.testnet` and 1 ctUSD with `olumight.testnet`.

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo check --target wasm32-unknown-unknown --locked
cargo near build non-reproducible-wasm --locked
```

`ARTIFACTS.md` records the reproducible build and executed testnet evidence.
`DEPLOYMENT_RUNBOOK.md` contains the approval-gated procedure used for the
deployment. Unit implementation for C-08 is complete. C-09 has passing local
Sandbox registration,
unauthorized-mint, transfer, resolver-refund, positive-balance unregistration
denial, forced burn/unregistration, and zero-balance unregistration evidence.
An exact registration-refund receipt assertion also passes. The deployed WASM
was downloaded and matched the reproducible artifact byte-for-byte.

No deployment, faucet, registration, mint, or transfer is part of the default
commands.

Backend integration must verify the exact contract ID/code hash, metadata,
`test_only` configuration, receiver registration, wallet-signed `ft_transfer`,
final receipts, and NEP-141 event before settlement. ctUSD must never be labeled
USDC or treated as a production asset.
