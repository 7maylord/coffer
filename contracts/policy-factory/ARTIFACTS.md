# Policy-factory artifact record

## Reproducible testnet release — 2026-11-07

- Source commit: `a915543569caa9ccf0ec873b5493acc1546d8462`
- Build: `cargo near build reproducible-wasm --manifest-path contracts/policy-factory/Cargo.toml`
- Build environment: `sourcescan/cargo-near:0.21.1-rust-1.96.0@sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`
- `near-sdk`: `5.29.1` (locked)
- Contract account: `factory.olymight.testnet`
- Network: NEAR testnet
- WASM size: `176581` bytes
- WASM SHA-256: `c1b502e137819e10beb319d51f262290b21891fb45da11cbc3fa204d26feee4e`
- NEAR/base58 code hash: `E39mq9jbJTMyqK82oxsGks78bw5n7JpmCxz1cC1RroLZ`
- Immutable policy code hash: `EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj`
- Funding transfer: `9igV4D89mjnKC4LL2rxNUfSHimSjTMouaxEPBbz77Ffi`
- Global policy publication: `Do9hLd29fVJt7eQHpCX1Z7hd9F9cFJ843JXgPEqjKJV8`
- Factory account creation: `5EwuM1BGEFB29q1eFEPHQfnptjS99L4t8KeCxYZRfSh3`
- Atomic factory deploy/init: `5uiKXzmqJrNubbV5gstXccrkCzktvzS3o3EZfLDcWJWM`
- Provisioner: `olymight.testnet`
- Minimum deployment deposit: `250000000000000000000000` yoctoNEAR

At final testnet block 276596977, downloaded factory bytes matched the release
SHA-256. Final views returned the reviewed policy hash and provisioner. The
factory had one full-access deployment key and a 2.9985416228734062 NEAR
balance; factory-created tenant instances add no keys.

The global policy RPC response was downloaded at finality and matched SHA-256
`ce52eeb90fd2f44e14ee5cb7360211add760493174f1ac173a3ed9e33eb13d6c`.
The embedded NEP-330 source links are not publicly resolvable until the owner
pushes source commits `08d56ef` and `a915543`; this workflow did not publish the
repository. Independent review remains required before mainnet.
