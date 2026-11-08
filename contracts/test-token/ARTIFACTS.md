# Test-token artifact record

## Reproducible testnet release — 2026-11-06

- Source commit: `08d56efd77c36abf8c8a7f80e87a0adeff779975`
- Build: `cargo near build reproducible-wasm --manifest-path contracts/test-token/Cargo.toml`
- Build environment: `sourcescan/cargo-near:0.21.1-rust-1.96.0@sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`
- Contract account: `ctusd.olymight.testnet`
- Canonical asset ID: `near:testnet:nep141:ctusd.olymight.testnet`
- Network: NEAR testnet
- WASM size: `153267` bytes
- WASM SHA-256: `7a69bb495b41788fd035daf238e3c8b5b8d1fb543671060d8acfb631e9c32111`
- NEAR/base58 code hash: `9ErFRZL31aDUPy6nBfztaCySidVzZsZsoyqP5x9NoM12`
- Account creation transaction: `k3e1ywc1mck7YcoXb3CFokjVeFUint3CpEoZCqFkmgB`
- Atomic deploy/init transaction: `HHty4C4pPM8otknWT7dKSKYL5yovtwH2eq2JGx6JSPFj`
- Issuer: `olymight.testnet`
- Maximum supply: `1000000000000` atomic = 1,000,000 ctUSD
- Mint transaction: `22Wx4cnkE1uuZT483qZfvBgS7fhf3qLGsRMwKKAX1c3k`
- Minted test float: `10000000000` atomic = 10,000 ctUSD
- Receiver storage registration: `H64ZSEbpWXBW97DxKxjw3cLZwZzRf7afXndHaJccQzBi`
- Smoke transfer: `4e9SNxg4DFXxSMT3Jzs5R3ch6QKt68FsjY8i5Wqnw73T`

The deployed WASM was downloaded at testnet block 276422629 and matched the
reproducible artifact exactly. Metadata is `Coffer Test Dollar` / `ctUSD` / six
decimals, and `get_test_token_config` reports `test_only: true`. The receiver
was registered using the contract-reported `0.00138 NEAR` minimum. Exactly
1,000,000 atomic units (1 ctUSD) moved from `olymight.testnet` to
`olumight.testnet`; final balances are 9,999 ctUSD and 1 ctUSD, with total
supply unchanged at 10,000 ctUSD.

This is valueless testnet evidence, not USDC or a production asset. Further
minting is a privileged external effect and is not authorized by this record.
The source commit has not been pushed by this workflow, so the embedded NEP-330
link is not publicly resolvable until the owner publishes that commit.

## Earlier local review build

This record is evidence for the current review slice. It is not a deployment
manifest and does not authorize deploying, registering, minting, or transferring.

- Built: 2026-10-28
- Command: `cargo near build non-reproducible-wasm --locked`
- Rust toolchain: `1.93.1`
- `near-sdk`: `5.29.1` (locked)
- `near-contract-standards`: `5.29.1` (locked)
- Build environment: local host (`CARGO_NEAR_BUILD_ENVIRONMENT=host`)
- WASM size: `154740` bytes
- WASM SHA-256: `18d51bd0756ffdf054b4583d9f1d4bf223763dbce41a5c6d97a2f685c41a5aa8`
- Base58 checksum: `2fwG2fhQcg4F5tusZR2MK3Pvkdn2iAgJZ2e78RSsxNDd`

The generated ABI exposes the standard NEP-141/145/148 surface, a private
`ft_resolve_transfer`, the initializer, `get_test_token_config`, and the payable
issuer-only `mint` extension. The ABI contains no policy, payroll, invoice,
treasury, bridge, swap, or Intents method.

Those generated files lived under ignored `target/` directories. A local
Sandbox flow passed for registration, unauthorized mint denial, exact transfer,
and failed receiver refund. At that checkpoint a reproducible build and broader
edge-case evidence remained required.

Reproducible builds use the same repository/HEAD provenance requirement as the
policy package. The historical local checksum remains review evidence only and
is superseded for deployment by the release record above.
