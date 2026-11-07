# Policy-factory internal security review

- Scope: FR-ID-002/003, FR-POL-001–003, FR-APR-001/002, COF-301/302, ADR-0017, C-10, Gates G3/G4.
- Code identity is an immutable 32-byte global-contract hash fixed at factory initialization. There is no upgrade or hash-change method.
- Provisioning is restricted to one immutable account, preventing public commitment squatting. That account can create and initialize instances but receives no implicit instance key or later authority; production should use independently reviewed multisig/DAO control.
- Each organization commitment can have only one pending/active record. A reverse account map rejects the theoretical 128-bit label-prefix collision.
- Instance creation is an atomic NEAR batch: create direct subaccount, transfer caller-funded balance, attach global code, initialize. No access key is added, so the instance is locked.
- The private callback accepts one bounded promise result. Success activates the reserved record; failure removes both indexes and refunds the exact attached deposit. Repeated callbacks cannot refund twice.
- Organization and policy commitments are exactly 32 bytes. Approvers are non-empty, unique, at most 16, include the controller, and satisfy a valid threshold.
- Factory collections are flushed before measuring their storage delta, so factory state is caller-funded. Instance balance has a 0.20 NEAR floor, total instances are capped at 10,000, and list pages are capped at 50.
- Events contain account IDs, caller IDs, status and code hash only. No PII, raw financial instruction, amount, recipient, payroll data, key or provider credential is accepted.
- The factory exposes no payment, token, approval, signing, deletion or self-upgrade method. It never receives tenant treasury assets by design.

The reproducible artifact, approved immutable global publication, factory
account, deposit, deployment and final byte/configuration checks are recorded in
`ARTIFACTS.md`. Open production blockers are an independent NEAR contract audit
and production key/governance design. A callback that permanently runs
out of gas can leave a record pending; no permissionless recovery method is
included until its account-existence proof and refund semantics are designed
and audited.
