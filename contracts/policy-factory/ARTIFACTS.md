# Policy-factory artifact record

Local review artifact only. This is not authorization to publish the global
policy code, deploy the factory, create accounts, or move funds.

- Built: 2026-11-06
- Command: `cargo near build non-reproducible-wasm --manifest-path contracts/policy-factory/Cargo.toml --locked`
- `near-sdk`: `5.29.1` (locked)
- Build environment: local host (`CARGO_NEAR_BUILD_ENVIRONMENT=host`)
- WASM size: `178879` bytes
- WASM SHA-256: `be733c1b4069e06de1a196b2c6ac5e55559eed5970dff86ba5a370042d7b6a79`
- Base58 checksum: `DpSNraj7RMxNiJiTY7zPA3NfoC9Qx3MWgiERgBG5gM5A`

The ABI must expose only the methods documented in `README.md`; the callback
must remain private. A testnet release requires a separately reviewed policy
WASM hash, global publication transaction, factory account, init arguments,
deployment deposit, source commit, and downloaded-byte verification.
