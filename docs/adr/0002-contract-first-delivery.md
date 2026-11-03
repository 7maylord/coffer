# ADR-0002: Contract-first delivery with a non-custodial approval commitment

- Status: accepted
- Date: 2026-10-28
- Related: ADR-002, ADR-004, ADR-005, FR-POL-001 through FR-POL-003, FR-APR-001 through FR-APR-002, FR-AUD-002, FR-PRV-005, COF-301, COF-302, Gate G4

## Context

The PRD makes a native NEAR contract optional because an unnecessary asset-holding contract increases custody, storage, asynchronous execution, upgrade, and audit risk. The owner has selected contracts -> backend -> frontend as the required implementation order. The current `contracts` directory contains the generated basic-auction tutorial and has no Coffer behavior.

A contract is justified only if it supplies a property the normal server cannot. For Coffer, that property is a public, independently queryable commitment proving that distinct eligible NEAR accounts approved the exact immutable proposal revision.

## Decision

Replace the auction with a native Rust/near-sdk policy and approval commitment contract before backend feature implementation begins. Keep it in the independent `contracts/near-policy` Cargo package.

The contract will manage organization commitments, eligible NEAR approvers, approval thresholds, policy digests, frozen/configuration state, proposal instruction digests, revisions, expiry, and distinct approvals. Backend and contract implementations will share golden vectors for a domain-separated canonical proposal digest.

The contract will not custody treasury assets, execute payments, call NEAR Intents, store private payroll or invoice data, accept arbitrary AI/provider text, or act as Coffer's accounting ledger. Contract events contain fixed identifiers, hashes, versions, and state only. The backend remains the authority for tenant RBAC, policy evaluation, double-entry accounting, provider reconciliation, and external execution safeguards.

P0 includes unit tests, NEAR Sandbox tests, storage/bounds tests, state-version migration coverage, ABI/artifact generation, and independent review. It excludes deployment. Testnet deployment is a later explicitly authorized validation step; meaningful mainnet custody would require a new ADR and independent audit.

A second independent package, `contracts/test-token`, supplies valueless six-decimal `ctUSD` solely for Sandbox/testnet settlement evidence. It does not weaken the policy contract boundary: `near-policy` still has no token or payment methods. Test-token behavior and deployment constraints are recorded separately in ADR-0004.

## Consequences

Backend proposal and approval work cannot begin until the contract ABI, digest format, and negative tests are stable. This delays the PRD's default off-chain critical path but removes cross-language authorization ambiguity before APIs and UI depend on it.

The on-chain approver account IDs and approval timing are public. Coffer must disclose that fact and keep amounts, recipients, invoice content, salaries, employee mappings, and raw policies off-chain.

The contract adds defense against a server silently rewriting an approved revision. It does not prove that a provider settled, that a ledger is balanced, that a human is legally authorized, or that public-chain activity is private. Backend checks remain mandatory.

## Rejected alternatives

- Keep the auction scaffold: it has no relationship to Coffer requirements and creates misleading track evidence.
- Build an asset-holding treasury contract first: this expands custody and async failure risk before the off-chain ledger and reconciliation kernel exist.
- Put raw proposal or payroll fields on-chain: this violates the PRD privacy boundary.
- Let the backend be the only contract administrator after bootstrap: it would make the on-chain quorum claim ineffective.
