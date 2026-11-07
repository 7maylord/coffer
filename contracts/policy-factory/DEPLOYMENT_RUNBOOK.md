# Policy factory testnet release

Scope: FR-ID-002/003, FR-POL-001–003, FR-APR-001/002, FR-AUD-001,
COF-301/302, ADR-0017, C-10 and G3/G4. Steps 1–5 were completed on NEAR
testnet on 2026-11-07; steps 6–7 remain the per-business onboarding path.

## Verified release inputs

The 217,225-byte reviewed policy WASM was published by immutable hash from
`olumight.testnet`; [NEAR global contracts](https://docs.near.org/smart-contracts/global-contracts)
burn roughly 10 NEAR per 100 KB. `factory.olymight.testnet` was created with 3
testnet NEAR, then deployed and initialized atomically. Exact transactions and
final byte/configuration evidence are in `ARTIFACTS.md`.

The policy code hash for the prior reproducible release is
`EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj`, with SHA-256
`ce52eeb90fd2f44e14ee5cb7360211add760493174f1ac173a3ed9e33eb13d6c`.
Its 32-byte hash as JSON base64 is
`zlLuuQ/S9E4U7ly3NgIRrddgSTF08awXOj7Z4z6xPWw=`. The reproducible factory hash
is `E39mq9jbJTMyqK82oxsGks78bw5n7JpmCxz1cC1RroLZ`.

## Release sequence

1. Review and commit the factory source, tests, lockfile, ADR and backend
   integration without bundling unrelated worktree changes. Build the factory
   reproducibly from that commit and record the resulting SHA-256 and NEAR
   base58 code hash. Run the contract tests and independent security review.
2. Check the intended publisher and factory account balances and ensure the
   factory account does not already contain state or keys you did not create.
3. Publish the **reviewed policy WASM** by immutable global hash, using a funded
   testnet publisher. Record the transaction hash and query the global code by
   hash to compare its downloaded bytes with the reviewed SHA-256.
4. Create and fund `factory.olymight.testnet`, deploy the reviewed factory WASM
   and atomically call `init` with provisioner `olymight.testnet` and the
   reviewed base64 policy hash. Record account creation and deployment hashes;
   compare the downloaded factory WASM with the release artifact.
5. Read `get_policy_code_hash`, `get_provisioner` and
   `minimum_deployment_deposit` at finality. Set all four `NEAR_POLICY_*` backend
   values to the verified factory account/hash, provisioner account and policy
   hash. The API stays read-only for chain operations.
6. Activate an organization's **first** policy version and verify its owner and
   approver NEAR wallets. `GET /v1/orgs/:orgId/policy-contract/deployment`
   lists the eligible inputs. Owner-only
   `POST /v1/orgs/:orgId/policy-contract/deployment-preview` with
   `{"controller":"<owner.testnet>","approvers":["<owner.testnet>","<second.testnet>"]}`
   returns one unsigned call with the factory receiver, provisioner signer,
   exact args, gas and deposit. The provisioner pays both gas and attached
   instance funding; recheck final chain state and the active policy before
   manually signing. Wait for the factory callback
   and final `Active` state; do not retry a `Pending` or unknown call blindly.
7. Call `POST /v1/orgs/:orgId/policy-contract/binding` as the owner. The backend
   verifies the factory and instance at one final block, checks zero instance
   access keys, current policy/quorum and distinct eligible humans, then writes
   one required tenant binding and an audit event. Confirm a later proposal
   verification uses the new instance.

The executed CLI shape for the first deployment operations was:

```sh
# After the release artifact, funding, and review are complete:
near contract deploy-as-global use-file contracts/near-policy/target/near/near_policy.wasm as-global-hash olumight.testnet network-config testnet sign-with-keychain send
near account create-account fund-myself factory.olymight.testnet '3 NEAR' autogenerate-new-keypair save-to-keychain sign-as olymight.testnet network-config testnet sign-with-keychain send
near contract deploy factory.olymight.testnet use-file contracts/policy-factory/target/near/policy_factory.wasm with-init-call init json-args '{"provisioner":"olymight.testnet","policy_code_hash":"zlLuuQ/S9E4U7ly3NgIRrddgSTF08awXOj7Z4z6xPWw="}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

The `3 NEAR` initial factory balance is an estimate for account/code storage
and gas, not an exact fee quote. Verify the current requirement immediately
before signing. Never paste private keys into shell commands or the API. The
factory account has a deployment key; keep it protected because that key can
upgrade the factory for **future** instances. Instance accounts themselves must
have no keys. Do not set `LIVE_TRANSFERS_ENABLED` for this release.

If an instance creation fails, check the final factory record, account
existence and refund receipt before retrying. A permanently stalled callback
can leave `Pending`; recovery is not implemented and needs a reviewed design.
No mainnet or production approval is implied by this testnet runbook.

NEAR [meta transactions](https://docs.near.org/protocol/transactions/meta-tx)
would make a relayer pay gas, but any attached deposit still comes from the
delegating user. When executed, Coffer's provisioner route sponsors both and does not
require the business owner to sign the factory creation. It does not sponsor
future owner/approver transactions or payment transfers.
