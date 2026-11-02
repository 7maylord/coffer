# Coffer NEAR policy contract

This non-custodial contract commits organization policy configuration, proposal
digests, revisions, expiry, and distinct human approvals. It never stores
payroll PII, invoice bodies, raw recipients, wallet secrets, or provider data,
and it never receives or transfers treasury assets.

Current slice: `C-01` through `C-04` are implemented locally for one organization per
deployment. The contract supports quorum-governed configuration, immutable
configuration history, proposal commitments, distinct approvals, cancellation,
expiry, bounded queries, and `coffer:proposal:v1` golden vectors. C-05 has a
passing multi-account quorum/unauthorized-caller Sandbox path that also rejects
a one-yocto storage underpayment and duplicate approval. Its
configuration path applies only after current quorum. Exact refund transfer
amounts are asserted in the VM, while Sandbox proves excess is returned and
permissionless expiry succeeds only after the deadline. Unit fixtures exercise
both fixed history caps, and Sandbox proves an under-gassed call leaves no
proposal state.

The byte contract is in `DIGEST_SPEC.md`, the checked-in vector is under
`test-vectors`, and `EVENTS.md` / `PRIVACY.md` define the public-data boundary.
`ARTIFACTS.md` records the latest local, non-reproducible review build.
`SECURITY_REVIEW.md` records the internal review and its open release blockers.
The dependency-free TypeScript digest and ABI fixture are under `ts/`; their
Node test proves parity with the Rust golden vector.

The private `migrate` initializer reads a retained legacy V0 layout and writes
V1 with an explicit state version. Its fixture preserves configuration history,
proposal records, and approval identities, and rejects current V1 bytes as an
unsupported legacy layout. No public code-upgrade method exists.

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo near build non-reproducible-wasm --locked
node --test ts/proposal-digest.test.ts
```

State-growing calls require an attached storage deposit. The contract charges
only net growth and refunds the excess attached deposit. Storage released by a
configuration change remains in the contract as a storage reserve; there is no
withdrawal method. Configuration and proposal histories are capped at 1,024 and
10,000 records respectively, and query pages are capped at 50 records.

Deployment is intentionally excluded from normal build and test commands.

Migration evidence limitation: V0 is a synthetic fixture, not a historical or
deployed contract layout. The conversion test does not certify any real upgrade;
a future upgrade must retain and test the exact deployed source layout.
