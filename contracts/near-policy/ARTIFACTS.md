# Policy-contract artifact record

## Reproducible testnet release — 2026-11-06

- Source commit: `08d56efd77c36abf8c8a7f80e87a0adeff779975`
- Build: `cargo near build reproducible-wasm --manifest-path contracts/near-policy/Cargo.toml`
- Build environment: `sourcescan/cargo-near:0.21.1-rust-1.96.0@sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`
- Contract account: `policy.olymight.testnet`
- Network: NEAR testnet
- WASM size: `217225` bytes
- WASM SHA-256: `ce52eeb90fd2f44e14ee5cb7360211add760493174f1ac173a3ed9e33eb13d6c`
- NEAR/base58 code hash: `EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj`
- Account creation transaction: `AW9QT6WdoRGoW2GR4PLaftrPFSAg32GxdihhxCsF8Hiw`
- Atomic deploy/init transaction: `7bGFGwcifovDD2PahKwxW3TpwMZpZG8MxZnEXAicYipN`
- Controller: `olymight.testnet`
- Approvers: `olymight.testnet`, `olumight.testnet`
- Threshold: 2
- Configuration version/state version: 1/1

The deployed WASM was downloaded at testnet block 276422626 and its SHA-256
matched the reproducible artifact exactly. `get_configuration` returned the
reviewed controller, commitments, two approver accounts, threshold, and an
unfrozen configuration.

The two approver accounts use distinct Ed25519 keys but are controlled by one
hackathon operator. This proves the cryptographic 2-of-2 contract path and
duplicate-account resistance; it is not evidence of two independent human
approvers. Independent contract review and independently controlled production
signers remain release blockers. The source commit has not been pushed by this
deployment workflow, so the embedded NEP-330 link is not publicly resolvable
until the owner publishes that commit.

## Earlier local review build

This record is evidence for the current review slice. It is not a deployment
manifest and does not authorize publishing or deploying the contract.

- Built: 2026-10-28
- Command: `cargo near build non-reproducible-wasm --locked`
- Rust toolchain: `1.93.1`
- `near-sdk`: `5.29.1` (locked)
- Build environment: local host (`CARGO_NEAR_BUILD_ENVIRONMENT=host`)
- WASM size: `220508` bytes
- WASM SHA-256: `ad33b0baaaddce318aae392d89da3d00cbfb8b97a3710591d23a6e919906413c`
- Base58 checksum: `Cf7FKdpUHxiKJUgPV2zgyo9Am6M871M8KPntan18jUaw`

The generated ABI was inspected after this build. Its public methods contain
configuration and proposal commitments only. The strings `amount_atomic`,
`authorized_max_atomic`, `recipient_commitment`, `asset_id`, `invoice`, and
`payroll` were absent from the ABI.

Those generated files lived under ignored `target/` directories and were not
release artifacts. At that checkpoint a reproducible container build and
independent contract review remained required by C-06/C-07. The build included
the explicit legacy V0-to-V1 state migration tested in the Rust suite.

The reproducible command attempted on 2026-10-28 stopped before Docker because
the workspace did not yet have a Git HEAD. That historical local checksum
remains review evidence only and is superseded for deployment by the release
record above.
