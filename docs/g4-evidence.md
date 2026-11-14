# Gate G4 evidence — 2026-11-14

Gate G4 covers J-02 through J-05, the native policy-contract quorum proof,
negative security demonstrations, and honest privacy evidence. This record is
for the hackathon demonstration gate only. It is not a production, compliance,
mainnet, custody, or independent-security-review approval.

## Result

**G4 is complete for the local/testnet demonstration scope with the private-AI
fallback active.** Coffer may demonstrate AI-assisted, policy-controlled
finance and the fail-closed private-inference boundary. It must not claim that
the current recording contains verified private inference until a fresh NEAR
AI Cloud call passes attestation, approved-deployment, and response-signature
verification.

This evidence relates to COF-301–403 and COF-501–503; FR-AI-001–004,
FR-AGT-001–004, FR-POL-001–003, FR-APR-001/002, FR-PRV-001–010,
FR-AUD-001–003; T-AI-01–05, T-AGT-01–06, T-POL-01–06, T-PRV-01–10,
T-ID-05–07, and T-PAY-03/04/06/07/10/11.

## J-02 — bounded CFO decision

- The Finance Agent accepts only tenant-authorized evidence references, exact
  integer ceilings, and schema-valid typed output.
- Provider timeout, malformed output, changed evidence, missing attestation,
  unapproved deployment digest, or invalid response verification stops the
  inference branch without changing money state.
- An `ALLOW` result can create one balanced internal reservation. It cannot
  sign, broadcast, change a recipient, or execute an external payment.
- Current live-provider status: **not exercised in this checkpoint**. The UI
  must show private AI verification as unavailable and the recording must not
  claim verified private inference.

## J-03 — bounded agent procurement

- Only the seeded, allowlisted document-classification service can be selected.
- Offer digest, service, vendor, asset, expiry, per-purchase limit, rolling
  limit, agent state, and immutable policy proposal are revalidated.
- Replays reuse the same purchase/proposal and cannot create a second spend.
- Fulfilment remains a seeded prototype. No external marketplace or live
  vendor payment is claimed.

## J-04 — treasury quorum and native contract proof

The deployed contract at `policy.olymight.testnet` was read at finality before
the proof: policy version `1`, unfrozen, threshold `2`, with approvers
`olymight.testnet` and `olumight.testnet`.

One valueless commitment was created and approved by the two distinct testnet
accounts:

| Step | Signer | Testnet transaction | Result |
| --- | --- | --- | --- |
| Create immutable proposal | `olymight.testnet` | [`HDuRmGfCYqRNsJK3EqBKFbzsd3tGwrN4K4bpjePGt1BV`](https://explorer.testnet.near.org/transactions/HDuRmGfCYqRNsJK3EqBKFbzsd3tGwrN4K4bpjePGt1BV) | `Pending`, revision 1, policy version 1 |
| First approval | `olymight.testnet` | [`8da9nkJws3sTHMGxDoptENJy9W31J56bCCUaBqJ1GSV1`](https://explorer.testnet.near.org/transactions/8da9nkJws3sTHMGxDoptENJy9W31J56bCCUaBqJ1GSV1) | `quorum_reached: false` |
| Second approval | `olumight.testnet` | [`2QiLbid63ZApM5pc7qNxcvyHPuEqmNcuUnBLEM4FNsdt`](https://explorer.testnet.near.org/transactions/2QiLbid63ZApM5pc7qNxcvyHPuEqmNcuUnBLEM4FNsdt) | `quorum_reached: true` |

Final read-only state returned `Approved`, both account IDs, `stale_policy:
false`, and `expired: false` for instruction digest
`fMMEGkIm8S/l/ZDJPjgk67SmFdICFCznODlPEDSrWCc=`. These two accounts are
separate cryptographic test keys controlled by one hackathon operator; this is
not production segregation of duties. The contract records commitments only
and did not transfer treasury assets.

The deployed factory was also read at finality: provisioner
`olymight.testnet`, minimum deployment deposit `0.25 NEAR`, and immutable policy
code hash `zlLuuQ/S9E4U7ly3NgIRrddgSTF08awXOj7Z4z6xPWw=`. The test token reports
`test_only: true`; it is not USDC and has no monetary value.

## J-05 — honest payroll privacy evidence

- Payroll fixtures are synthetic; sensitive fields are envelope-encrypted and
  excluded from logs, manifests, model evidence, public events, and contracts.
- Finance access, auditor redaction, employee self-only reads, cross-tenant
  denial, exact manifest approval, and same-hash payout reconciliation are
  tested.
- The destination-chain transfer remains public. Coffer does not claim that a
  hidden UI, ciphertext at rest, testnet transfer, or deterministic fallback is
  a confidential public-chain payout or verified private AI.

## Negative demonstrations

Automated evidence covers over-cap and rolling-limit denial, recipient
allowlist denial, changed proposal revision, duplicate-person approval,
duplicate contract approval, expired proposal, frozen policy, unauthorized
proposer, cross-tenant reads, employee-to-employee disclosure, prompt/output
tampering, arbitrary vendor URLs, expired/revoked offers, duplicate purchase,
provider timeout, unverified settlement success, unknown payout evidence, and
same-hash-only reconciliation.

## Verification results

All commands ran from the repository revision in the current dirty worktree;
hosted CI on a committed revision remains a G5 item.

| Check | Result |
| --- | --- |
| Backend unit | 43 files, 348 tests passed |
| PostgreSQL integration on isolated `coffer_g4` database | 13 files, 56 tests passed |
| Authenticated API E2E | 5 files, 14 tests passed |
| G4 frontend Playwright, desktop and mobile | 40 tests passed |
| Frontend unit | 12 tests passed |
| NEAR contracts | policy 22 unit + 1 Sandbox; token 18 unit + 1 Sandbox; factory 11 unit + 1 Sandbox passed |
| Frontend/backend lint and typecheck | passed; backend lint retained existing test-only warnings |
| Frontend/backend production builds | passed |
| Contract fmt, clippy, WASM check, interface parity, artifact verification | passed |
| Credential marker scan | 311 source files passed |
| Critical PRD manifest | 54 required IDs across 61 test files passed |
| OpenAPI consistency | passed with `node --import tsx scripts/generate-openapi.ts --check` |

## Remaining external evidence

1. A fresh authenticated NEAR AI Cloud call is required before checking the
   verified-private-inference claim. It may consume provider credits and must
   use a human-reviewed deployment digest.
2. The final video must use synthetic data, show the explorer evidence, and
   preserve the fallback wording if item 1 is not completed.
3. Hosted CI, clean-machine installation, browser/accessibility review, public
   repository, X post, and submission remain Gate G5.
