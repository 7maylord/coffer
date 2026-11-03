# ADR-0005: Deterministic policy and proposal authorization

- Status: accepted locally
- Date: 2026-10-30
- Related: ADR-002, ADR-004, ADR-005, COF-301, COF-302, COF-303, FR-POL-001-003, FR-APR-001-002, T-POL-01-06, T-CON-10, Gate G3

## Context

Coffer must authorize an exact financial instruction without allowing an AI,
HTTP caller, duplicate signer, stale rule set, database race, or unavailable
NEAR RPC to widen that authorization. Native NEAR policy evidence is optional,
but when an organization binds a contract the evidence must match one finalized
block and the locally approved instruction.

## Decision

Policy rules are normalized and hashed before storage. Evaluation uses integer
atomic amounts and returns `ALLOW`, `DENY`, or `REQUIRES_APPROVAL` with stable
reason codes and an input digest. Policy definitions, decisions, proposal
material, and approvals are immutable database facts. A material edit creates a
new revision and digest; policy replacement marks open proposals stale.

Proposal creation and revision lock the organization, recheck the active policy,
and recheck rolling capacity inside a serializable transaction. Serialization
failures retry four times. This closes the gap between the preliminary policy
evaluation and durable proposal creation. Reusing an earlier policy body creates
a new version with the same content digest, preserving exact policy history.

Approvals require an active owner or approver membership and a wallet previously
verified through NEP-413. A user counts once even with multiple wallets. Before
execution, the server recomputes the canonical `coffer:proposal:v1` digest,
re-evaluates current policy and expiry, and rechecks that enough approving users
still have active eligible memberships and the recorded testnet accounts.

If a policy contract binding exists, the verifier reads configuration at final
finality, pins proposal and code queries to that exact block, validates canonical
response schemas, code hash, network, commitments, policy version, threshold,
expiry, state, and exact approver accounts. Any malformed response, mismatch, or
RPC error fails closed. The adapter only creates unsigned call descriptions;
wallet signing and deployment remain separate, manually authorized actions.

## Consequences

Database approval is sufficient for the local mock path when no contract binding
exists. A configured contract is never treated as advisory: verification failure
blocks execution. This module does not sign, submit, retry, or reconcile a
payment, and it does not claim that an off-chain ledger balance is on-chain
custody. Those effects remain in later settlement checkpoints.
