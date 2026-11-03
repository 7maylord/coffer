# Local test-token artifact record

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

Generated files live under ignored `target/` directories. A local Sandbox flow
passes for registration, unauthorized mint denial, exact transfer, and failed
receiver refund. A reproducible build and broader edge-case evidence remain
required before this becomes a release artifact.

Reproducible builds use the same repository/HEAD provenance requirement as the
policy package. This workspace currently has no Git repository, so the local
checksum remains review evidence only.
