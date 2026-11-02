# Internal security review — NEAR policy contract

- Review date: 2026-10-28
- Scope: `contracts/near-policy/src/lib.rs`
- Requirements: FR-POL-001–003, FR-APR-001–002, FR-AUD-001–002,
  FR-PRV-005, COF-301, COF-302, ADR-0002, Gate C0 / G4
- Status: internal review complete; independent C-07 sign-off remains open

This is a pre-deployment review of a non-custodial commitment contract. It is
not an independent audit and does not authorize deployment.

## Surface and trust boundary

The contract has one organization per deployment. Current eligible approvers
may propose configuration changes and proposal commitments. Current quorum is
required to apply configuration; distinct current approvers are required to
approve proposals. The controller or original proposer may cancel a pending
configuration/proposal as documented. Anyone may finalize expiry after the
committed timestamp.

The contract has no token receiver, transfer, arbitrary callback, cross-contract
function call, upgrade method, private key, provider credential, or payment
execution method. The only promise transfers refund excess attached storage
deposits to the predecessor account.

## Checks performed

- all exported methods and generated ABI reviewed;
- `predecessor_account_id`, one-yocto, and positive-deposit policies reviewed;
- collection prefixes, explicit flushes, bounds, pagination, and storage charge
  paths reviewed;
- configuration/proposal lifecycle, duplicate approval, expiry, freeze, stale
  policy, and revision identity reviewed;
- integer conversion, checked arithmetic, JSON-safe `U64`/`U128`, and absence
  of floating point reviewed;
- event format and forbidden-data scan reviewed;
- migration and deployment posture reviewed;
- `cargo fmt --check`, Clippy with warnings denied, unit tests, WASM check, local
  build, checksum, and generated ABI privacy scan run.

## Resolved findings

### SR-01 — Medium — cancelled configuration history could be overwritten

The configuration digest is deterministic. Reproposing the same cancelled
change at the same base version would have replaced the prior map record. The
contract now rejects every previously used configuration digest with
`COF_CON_055`; a regression test proves cancelled history remains immutable.

### SR-02 — Medium — event logs were not NEP-297 parseable

The JSON body was correct but lacked the required `EVENT_JSON:` prefix. The
event helper now emits the prefix, and the redaction test asserts it.

### SR-03 — Medium — migration only validated the current state layout

The migration initializer now retains an explicit legacy V0 Borsh layout,
deserializes the raw state with deterministic missing/unsupported-layout errors,
and constructs V1 with an explicit state version. Tests prove configuration,
applied history, proposals, and approval identities survive, and that V1 bytes
cannot be mistaken for V0. There is still no public self-upgrade method.

### SR-06 — test gap — Sandbox coverage was incomplete

The local Sandbox test now proves deployment, persisted proposal state,
outsider denial, insufficient storage-deposit rejection, excess-deposit return,
duplicate approval rejection, two-account quorum, quorum-governed configuration,
pre-expiry denial, permissionless post-expiry finalization, and atomic failure
without state writes when the call has insufficient gas. A VM receipt assertion
proves the exact storage refund amount without conflating the protocol gas
reward. Unit fixtures exhaust both fixed history limits and reject another write.

## Open release blockers and accepted limitations

### SR-04 — Medium — fixed history caps require an operational rotation plan

The caps prevent unbounded gas and storage growth, but an organization cannot
create more records after 1,024 configuration changes or 10,000 proposals.
Only authorized approvers can consume this paid capacity. Before production,
Coffer needs a reviewed contract-rotation/archive plan that preserves proof
continuity. The limits are acceptable for the hackathon test deployment.

### SR-05 — Low — released storage remains a contract reserve

State-growing calls pay net storage growth and receive excess attached deposit
refunds. When an applied configuration shrinks the approver set, released stake
is retained by the contract because historical payers are not safely
attributable. There is no withdrawal method. This is documented behavior and
must remain separate from treasury accounting.

No unresolved critical or high issue was found in this internal pass. C-07
remains open because an independent review is outstanding.

Migration evidence limitation: V0 is a synthetic fixture, not a historical or
deployed contract layout. The conversion test does not certify any real upgrade;
a future upgrade must retain and test the exact deployed source layout.
