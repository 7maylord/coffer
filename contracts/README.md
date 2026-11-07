# Coffer contracts

The contracts domain contains three independently buildable NEAR Rust projects:

| Package | Purpose | Holds funds? |
|---|---|---|
| `near-policy` | Policy, proposal, revision, expiry, and approval commitments | No |
| `policy-factory` | Creates one locked `near-policy` instance per organization from an immutable global code hash | Deployment deposits only |
| `test-token` | Test-only NEP-141 `ctUSD` for Sandbox/testnet payments | Test balances only |

Build and test each package from its own directory. There is no root Cargo
package and no dependency on the independent frontend or backend pnpm projects.
All packages have unit and local Sandbox paths. Reproducible artifacts
from commit `08d56ef` are deployed on NEAR testnet at
`policy.olymight.testnet` and `ctusd.olymight.testnet`; deployment does not make
either contract production-approved.

| Contract | Reproducible code hash | Deploy/init transaction |
|---|---|---|
| `policy.olymight.testnet` | `EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj` | `7bGFGwcifovDD2PahKwxW3TpwMZpZG8MxZnEXAicYipN` |
| `factory.olymight.testnet` | `E39mq9jbJTMyqK82oxsGks78bw5n7JpmCxz1cC1RroLZ` | `5uiKXzmqJrNubbV5gstXccrkCzktvzS3o3EZfLDcWJWM` |
| `ctusd.olymight.testnet` | `9ErFRZL31aDUPy6nBfztaCySidVzZsZsoyqP5x9NoM12` | `HHty4C4pPM8otknWT7dKSKYL5yovtwH2eq2JGx6JSPFj` |

The old generated auction scaffold is preserved under `_archive/basic-auction`
only because irreversible deletion was not approved. It is ignored and is not a
Coffer contract, build input, or deployment target.

Routine tests never deploy or mutate testnet. The authorized 2026-11-06 policy
and token deployment and 2026-11-07 factory deployment evidence is recorded in each
package's `ARTIFACTS.md` and the test-token runbook. Further signing or state
changes still require reviewed values and explicit authorization.

`policy-factory` is deployed and byte-verified at
`factory.olymight.testnet`. The reviewed policy WASM is published globally by
immutable hash. The factory pins that hash, creates a deterministic
direct subaccount without access keys, initializes it atomically, and records
the organization commitment-to-account mapping. The shared `ctUSD` contract is
not cloned per tenant.

The backend now prepares owner-scoped provisioning data and verifies a final
factory instance before binding its account and code hash to the organization.
The provisioner still signs the creation call outside the API. Synchronizing
later policy revisions through the approver quorum, unsigned wallet actions,
and final settlement verification remain open. See the
[factory deployment runbook](policy-factory/DEPLOYMENT_RUNBOOK.md). No contract
should gain custody, provider, payroll, or application orchestration logic.
