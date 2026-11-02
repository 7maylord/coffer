# Local policy-contract artifact record

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

The generated files live under ignored `target/` directories and are not
release artifacts. A reproducible container build, checked-in release manifest,
an independent contract review remain required by C-06/C-07. The build includes
the explicit legacy V0-to-V1 state
migration tested in the Rust suite.

The reproducible command was attempted on 2026-10-28 and stopped before Docker:
`cargo-near` requires the contract to be inside a Git repository with a HEAD,
but this workspace is not a Git repository. The local checksum above remains
review evidence only.
