# ADR-0017: Immutable-hash policy instance factory

- **Status:** Accepted
- **Date:** 2026-11-06
- **Requirements:** FR-ID-002/003, FR-POL-001–003, FR-APR-001/002, FR-AUD-001/002, COF-301/302
- **Gate:** C-10 local evidence; G3/G4 remain incomplete

## Context

Coffer is multi-tenant, while `near-policy` intentionally stores one
organization's controller, approvers, policy commitment and proposal history.
A single shared policy state map would enlarge the blast radius, complicate
storage and authorization proofs, and couple all tenants to one upgrade. Manual
deployment per business does not scale and can initialize inconsistent code.

NEAR permits a factory to create a direct subaccount, attach existing global
contract code and initialize it in one promise batch. Direct subaccounts do not
give the parent implicit control, and an account created without access keys is
locked. A global contract referenced by code hash is immutable, whereas an
account-ID reference follows future publisher updates.

## Decision

`contracts/policy-factory` creates one locked policy subaccount per opaque
organization commitment. The factory is initialized with one immutable
provisioner account and one immutable global `near-policy` code hash. Restricting
creation prevents public commitment squatting. It validates the same bounded
bootstrap quorum, records a pending reservation, creates the direct subaccount without keys, funds it
from the caller's deposit, attaches the global code and invokes `init` in one
batch. Its private callback activates the record or removes it and refunds the
caller on failure.

The subaccount label is the lowercase hex encoding of the first 128 bits of the
32-byte commitment. A reverse map rejects any collision. Factory IDs are capped
at 31 characters, instance count at 10,000 and query pages at 50. Commitments
must be domain-separated, high-entropy hashes because all chain state is public.

The provisioner receives no implicit instance key or post-initialization
authority. The factory cannot update its code hash, add instance keys, change
tenant policy, approve proposals, hold treasury funds or execute payments.
`ctUSD` remains one
shared test-token deployment; it is not cloned with policy instances. The
backend stores the resulting instance account and verifies its code hash and
configuration before treating it as tenant evidence.

Backend binding is owner-only and read-only on NEAR. It checks the factory
code/configuration, active instance, deterministic account, policy code hash,
zero instance keys, exact policy digest, and distinct currently authorized
approver wallets at one final block before a transactional, audited binding.
The provisioner signs instance creation outside the backend. The current
bootstrap path accepts only an organization's first active policy version,
because `near-policy.init` sets configuration version 1; existing organizations
need a reviewed quorum-governed synchronization path before binding.

An organization owner can request a canonical unsigned sponsor call after
policy setup. When that call is executed, the provisioner account pays both call gas and the instance
deposit. NEAR meta transactions would sponsor only gas; their attached deposit
remains the delegating user's cost. Coffer account registration alone does not
trigger an on-chain deployment; one contract is created for each eligible
business organization after policy and approvers exist. Automatic provisioner
signing needs separate bounded spend authorization, durable idempotency and
reconciliation before it can be enabled.

## Consequences

- Tenant policy state and contract balances are isolated by NEAR account.
- Every factory-created instance uses identical reviewed bytes and has no
  administrator key or unilateral factory upgrade path.
- A new policy release requires a new reviewed factory or a separately designed,
  quorum-authorized migration; the existing factory cannot silently change code.
- Global publication is an irreversible, higher-cost transaction and factory
  deployment/account funding require separate human approval.
- Callback failure is compensated, but an exceptional callback gas failure can
  leave a pending record. Recovery is intentionally deferred until it can prove
  account state without enabling duplicate refunds.

## Evidence boundary

Unit tests inspect the action batch, reject duplicate/underfunded requests,
exercise success/failure callbacks and exact refund scheduling, and prove no key
action exists. Sandbox publishes policy code by immutable hash, creates an
instance through the factory, reads its initialized configuration and verifies
an empty access-key list. No testnet/global publication or deployment is part of
this ADR's local implementation authorization.

References: [NEAR factory pattern](https://docs.near.org/web3-apps/tutorials/mastering-near/4-factory),
[global contracts](https://docs.near.org/smart-contracts/global-contracts), and
[account actions](https://docs.near.org/smart-contracts/anatomy/actions#create-a-sub-account).
