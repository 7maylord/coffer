# Coffer policy factory

The factory gives each Coffer business an isolated NEAR policy instance. That
lets a multi-tenant finance operating system preserve per-business approval
rules while using one reviewed policy implementation. It is an authorization
factory—not a wallet, treasury, or payment executor.

This NEAR contract creates one isolated, locked `near-policy` instance for each
organization. It implements FR-ID-002/003, FR-POL-001–003, FR-APR-001/002,
COF-301/302, ADR-0017, and contract milestone C-10 toward Gates G3/G4.

The factory is initialized once with an immutable provisioner account and the
32-byte SHA-256 hash of an already published global `near-policy` WASM. It
references that immutable hash—not a publisher account—so every instance runs
the reviewed bytes. A create call:

1. requires the provisioner and validates the 32-byte organization/policy commitments and bounded approver quorum;
2. reserves the organization and a deterministic 128-bit commitment-prefix subaccount;
3. keeps only the factory storage cost and transfers the remaining deposit to the instance;
4. creates the direct subaccount without any access key, attaches the global code, and calls `near-policy.init` in one batch;
5. marks the record active on callback success, or removes it and refunds the original attached deposit on failure.

The factory account ID must be at most 31 characters so the derived account is
a valid 64-character-or-shorter NEAR account. The minimum attached deposit is
0.25 NEAR; at least 0.20 NEAR reaches the instance after factory storage. Query
`minimum_deployment_deposit` rather than duplicating the value in clients.

Public methods:

- `init(provisioner, policy_code_hash)`
- `create_policy_instance(organization_commitment, controller, policy_digest, approvers, approval_threshold)`
- `get_policy_code_hash()`
- `get_provisioner()`
- `minimum_deployment_deposit()`
- `get_instance(organization_commitment)`
- `list_instances(from_index?, limit?)`
- private `on_create_policy_instance(organization_commitment)`

The provisioner can create instances but cannot alter or control them after
initialization unless it is separately named in their approver set. The factory
cannot approve proposals, change policy configuration, hold tenant
treasury assets, mint ctUSD, call Intents, or sign/execute payments. `ctUSD`
remains a single shared test token. Organization commitments must be
domain-separated, high-entropy hashes; account IDs and commitments are public.

Build and test locally:

```sh
cargo fmt --manifest-path contracts/policy-factory/Cargo.toml --check
cargo clippy --manifest-path contracts/policy-factory/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path contracts/policy-factory/Cargo.toml --locked
cargo near build non-reproducible-wasm --manifest-path contracts/policy-factory/Cargo.toml --locked
```

The Sandbox test publishes `near-policy` as an immutable global contract,
deploys this factory, creates an instance, verifies its initialized policy
configuration, and proves the instance has no access keys. Publishing a global
contract costs more than an ordinary deployment and is irreversible; local
implementation is not authorization to publish or deploy it.

Protocol references: [factory pattern](https://docs.near.org/web3-apps/tutorials/mastering-near/4-factory),
[global contracts](https://docs.near.org/smart-contracts/global-contracts), and
[account actions](https://docs.near.org/smart-contracts/anatomy/actions#create-a-sub-account).

Licensed under the repository [MIT License](../../LICENSE).
