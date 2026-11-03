# ADR-0003: Direct NEAR testnet fallback when 1Click is unavailable

- Status: accepted
- Date: 2026-10-28
- Related: ADR-002, ADR-003, FR-PAY-001 through FR-PAY-007, COF-202 through COF-205, T-PAY-01 through T-PAY-12, Gates G2-G3

## Context

NEAR Intents 1Click has no public testnet. Its realistic execution path uses supported mainnet assets and therefore cannot be a routine automated hackathon test. The hackathon requires a working prototype, public repository, and public demo post, but the current rules do not state that a live or testnet payment transaction is mandatory.

Mock settlement is required to exercise deterministic failure, refund, duplicate, delay, underfunded, and reconciliation paths. Mock-only evidence, however, does not demonstrate wallet authorization or on-chain reconciliation.

## Decision

Keep `mock` as the default and add an optional `near-testnet` settlement adapter for direct native testnet NEAR transfers and registered test-only `ctUSD` NEP-141 transfers. The payer or employer signs from a user-controlled wallet. Coffer never stores the key.

The backend treats the submitted transaction hash as untrusted. For native NEAR it verifies the configured network, signer, receiver, exact yoctoNEAR amount, transfer action, final transaction/receipt outcomes, and one-time use. For `ctUSD` it additionally verifies the exact registered token contract, `ft_transfer` arguments, six-decimal atomic amount, attached-deposit rule, standard event, and final receipt chain. A timeout or ambiguous receipt enters reconciliation and never triggers a second transfer.

The testnet route is labeled with its exact asset: native testnet NEAR or valueless Coffer Test Dollar (`ctUSD`). Neither is described as official USDC, real stablecoin value, a 1Click swap, confidential payment, production payroll, or proof of mainnet liquidity. 1Click remains a separate adapter with current token discovery, dry quotes, and an explicitly approved mainnet experiment only if available.

## Consequences

Coffer can demonstrate a real NEAR wallet signature and verified testnet transaction without depending on a nonexistent 1Click testnet. Mock mode still supplies the complete adverse-state demonstration.

The direct adapter does not prove cross-chain settlement. Track and demo materials must distinguish contract approval, direct testnet NEAR transfer, mocked settlement, 1Click dry quote, and any separately approved live experiment.

Coffer may expose all three adapters in one demo through a typed adapter and asset registry. The initial supported assets are fictional six-decimal mock USDC identifiers for the mock adapter, native 24-decimal testnet NEAR and contract-identified six-decimal `ctUSD` for the direct adapter, and only current provider-returned asset IDs for Intents. Asset symbols never establish identity, and ledgers balance per canonical asset.

No testnet account creation, faucet request, wallet signing, token minting, contract deployment, or transaction submission is authorized by this ADR.
