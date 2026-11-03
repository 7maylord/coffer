# Internal security review — Coffer Test Dollar

- Review date: 2026-10-28
- Scope: `contracts/test-token/src/lib.rs`
- Requirements: FR-PAY-003/007, COF-203, ADR-0004, T-FT-01–08, Gate C0/G3
- Status: C-08 internal review complete; C-09 Sandbox/release review open

This is an internal pre-deployment review. It is not an independent audit and
does not authorize deployment or any on-chain action.

## Trust boundary

The configured issuer may mint valueless test tokens up to an immutable maximum
supply. Mint requires exactly one yoctoNEAR so a restricted function-call key
cannot exercise it. Receivers must already be registered under NEP-145. Normal
transfers and resolver behavior delegate to `near-contract-standards 5.29.1`.

## Review results

- Standard core, resolver, storage, metadata, and event implementations are used;
- resolver is private and transfer calls delegate to the standard promise chain;
- transfer and mint amounts use `U128`/`u128` integer arithmetic only;
- maximum-supply addition is checked before minting;
- mint, transfer, and storage-sensitive methods enforce their deposit rules;
- storage registration is paid by callers through the standard implementation;
- forced unregistration emits the standard burn event for destroyed balances;
- memo and transfer-call message sizes are capped;
- metadata and public config identify the asset as `ctUSD` and test-only;
- no policy, payroll, invoice, treasury, swap, bridge, Intents, signing, or
  upgrade behavior exists;
- generated deployment workflows that embedded secret-based automated signing
  were removed from both contract packages.

No critical/high issue was found in this internal pass.

## Open release blockers

- A local Sandbox flow proves real receipt persistence, registration, exact
  transfer, unauthorized mint denial, full refund when `ft_on_transfer` is
  missing, positive-balance unregistration denial, forced burn/unregistration,
  and zero-balance unregistration. A VM receipt assertion proves exact excess
  registration refunds. Sandbox submits two transfers concurrently from independent signers into
  one receiver and asserts exact balances and unchanged total supply. This does
  not cover every asynchronous transfer-call/unregistration interleaving.
- The checked checksum is a local host build, not the reproducible release build.
- A deployed contract ID, network, downloaded code hash, issuer, and maximum
  supply must be verified together before the backend asset registry can enable it.
- The issuer is intentionally permanent for the hackathon contract. A production
  issuer-rotation or revocation design would require a new reviewed version.

Additional local evidence: a VM test schedules `ft_transfer_call`, unregisters
sender or receiver before a failed callback, and verifies resolver return value,
both zero balances and zero total supply. This does not substitute for an
independent audit or all possible Sandbox receipt interleavings.
