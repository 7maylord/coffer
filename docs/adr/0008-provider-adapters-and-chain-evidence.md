# ADR-0008: Provider adapters and independently verified chain evidence

- Status: accepted
- Date: 2026-10-30
- Related: COF-203, COF-204, FR-PAY-003, FR-PAY-006, FR-PAY-007, T-PAY-01, T-PAY-07, T-PAY-10, T-PAY-11, T-PAY-12, Gate G3

## Context

NEAR Intents 1Click has no public testnet. Testnet NEAR and Coffer Test Dollar
(`ctUSD`) can demonstrate wallet authorization and finalized NEAR execution, but
they cannot demonstrate a 1Click route or production-value settlement. A quote,
provider status, submitted transaction hash, or wallet callback is untrusted
until its exact provider or chain evidence is independently checked.

Current official references reviewed at this checkpoint:

- 1Click quickstart and no-testnet limitation:
  https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction
- token, quote, deposit, and status flow:
  https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
- quote signature verification:
  https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature
- finalized NEAR deposit verification:
  https://docs.near.org/integrations/deposits
- NEP-141 transfer and registration behavior:
  https://docs.near.org/integrations/fungible-tokens

## Decision

Coffer keeps three typed adapter identities: `mock`, `near-testnet`, and
`near-intents`. Mock remains the default. Testnet and Intents capabilities use
separate flags, and the global live-transfer flag does not enable either one by
itself.

`NearTestnetTransferAdapter` never accepts or loads a private key. It produces
an exact transaction description for a user-controlled wallet and verifies the
result by querying the configured testnet RPC with the submitted hash and
original signer at `FINAL`. It requires the RPC chain ID, transaction hash,
signer, transaction receiver, single action, receipt receiver, receipt outcome,
executor, amount, and all receipt statuses to match. Native NEAR requires one
exact `Transfer`. `ctUSD` requires the configured contract code hash, exact
six-decimal metadata, test-only contract config, receiver storage registration,
a one-yocto `ft_transfer`, exact arguments, and matching NEP-297 transfer event.

Verified testnet evidence is claimed in PostgreSQL. Unique provider/network/hash
and organization/reference constraints prevent a transaction from satisfying a
second payment or tenant. An RPC timeout or ambiguous response is unresolved;
it cannot authorize a replacement transfer.

`NearIntents1ClickAdapter` fetches `/v0/tokens` before each quote and accepts
only current provider-returned asset IDs. It sends atomic integer amounts using
`EXACT_INPUT`, origin-chain deposit/refund, destination-chain recipient, bounded
slippage, and a caller deadline. Responses are runtime validated, bounded,
sanitized, and signature checked with
`@defuse-protocol/one-click-sdk-typescript` 0.1.26. The adapter maps exactly
`PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`,
`INCOMPLETE_DEPOSIT`, `REFUNDED`, and `FAILED`. Unknown or malformed values fail
closed.

Token discovery and dry quotes have a read-only flag. Non-dry quote creation
and deposit submission additionally require both the Intents wet-quote flag and
the global live-transfer flag. Confidentiality additionally requires its own
flag. Polling is read-only so an existing live operation can still be reconciled
after outbound execution is disabled.

## Consequences

Local and CI tests use sanitized provider/RPC fixtures and perform no external
transfer. A real testnet demonstration still requires an owner-approved wallet,
deployed contract evidence where applicable, manual signature, and recorded
transaction hash. A 1Click mainnet deposit remains separately approved and is
never a routine test.

The adapter layer does not itself post settlement to the ledger. Durable payment
orchestration must persist the instruction before wallet or provider side
effects, then feed verified evidence through the existing idempotent settlement
and reconciliation path.
