# ADR-0018: Wallet-signed payroll payouts with independent reconciliation

- Status: accepted for the gated testnet slice
- Date: 2026-11-09
- Related: COF-501, FR-PAY-004-007, FR-PRV-003, FR-AUD-001, T-PAY-04/05/10/11, Gates G3-G4

## Context

An approved payroll manifest previously had no payout path. Giving the API or
AI a wallet key would turn a data and policy service into an unrestricted
custodian. Treating a wallet callback as success would also allow a wrong
signer, recipient, asset, amount, or failed receipt to mark payroll settled.

## Decision

Coffer persists one immutable payout run and one instruction digest per payroll
line before presenting any wallet request. Preparation requires the exact
approved manifest/version, an idempotency key, the `payroll:payout` permission,
the global live gate, the testnet adapter gate, and the payroll payout gate.
Only canonical native testnet NEAR or the configured reviewed NEP-141 test token
is accepted.

The authenticated, verified organization wallet signs each transaction. The
backend stores no signing key and the AI receives no signing or transfer tool.
For every submitted hash, Coffer first claims that hash transactionally and
marks the line `RECONCILING`, then independently resolves final NEAR RPC evidence
and verifies network, signer, receiver, asset, exact integer amount, method,
arguments, gas, deposit, receipts, and success. Transaction evidence is
idempotent only when every bound field matches; replay across another tenant or
line fails. An RPC outage retains the original hash, returns no replacement
wallet transaction, and accepts only a same-hash recheck. A database lock
serializes item reconciliation, and the batch
becomes settled only after every line is verified.

Payroll plaintext remains in its existing encrypted envelope. The payout tables
store instruction commitments and public chain evidence, not decrypted legal
names, addresses, payout accounts, or salary amounts. Authorized preparation
responses necessarily expose the exact amount and recipient to the finance
operator and wallet.

## Consequences

- Testnet payout preparation and reconciliation can be exercised end to end
  without backend custody.
- Chain transfers are public; this does not make payroll payments confidential.
- A payout run is append-only in intent: another signer, key, manifest, or
  instruction conflicts instead of replacing it.
- The flag remains off by default. No transaction is broadcast without a human
  wallet confirmation.
- This is not legal payroll or production mainnet readiness. Independent
  multi-person authorization, jurisdiction-specific payroll calculations,
  KMS rotation, retention/data-residency controls, custody/legal review,
  exception operations, and an independently reviewed mainnet asset route are
  still required.

## Testnet reconciliation evidence

On 2026-11-10, the existing direct adapter independently reconciled finalized
transaction `4J4xcE7pCYZGMy29zBGUVehpnDQyi6Ft7KxrXXKZ5dWn`: an operator-signed
transfer of one atomic ctUSD unit from `olymight.testnet` to
`olumight.testnet`. It verified the configured token code and metadata,
receiver registration, signer, receiver, method, arguments, 30 TGas,
one-yocto deposit, successful receipts and matching NEP-297 event. The local
database retained immutable evidence digest
`a68459e0ae7d61d115af51c14c7d9ca3f83dfcb3005a1e2b225534f5fe1ff4a2`.

This proves the adapter and durable evidence path against live testnet. It was
not prepared through the authenticated payroll API and does not prove the
browser wallet batch flow, batch state transitions or payroll authorization.
