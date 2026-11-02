# Coffer contracts

The contracts domain contains two independently buildable NEAR Rust projects:

| Package | Purpose | Holds funds? |
|---|---|---|
| `near-policy` | Policy, proposal, revision, expiry, and approval commitments | No |
| `test-token` | Test-only NEP-141 `ctUSD` for Sandbox/testnet payments | Test balances only |

Build and test each package from its own directory. There is no root Cargo
package and no dependency on the independent frontend or backend pnpm projects.
Both packages have passing unit and local Sandbox paths; the policy adversarial
storage/capacity matrix and reproducible release builds remain contract-gate work.

The old generated auction scaffold is preserved under `_archive/basic-auction`
only because irreversible deletion was not approved. It is ignored and is not a
Coffer contract, build input, or deployment target.

Neither contract is deployed by routine tests. Testnet deployment, account
creation, faucet use, wallet signing, and live transfers require a separate
reviewed command and explicit authorization.
