# Provider capability matrix

Checkpoint: 2026-11-08. Provider adapters remain disabled by default. Automated
tests use sanitized fixtures. An explicitly approved NEAR testnet policy/ctUSD
deployment and valueless ctUSD smoke transfer were executed; no 1Click, NEAR AI,
mainnet, payroll payout, or production-value operation was executed.

| Provider | Base URL / docs | Credentials | Current use | Status and refund semantics | Privacy / limitations |
|---|---|---|---|---|---|
| Coffer mock settlement | local API | none | Enabled by default | Deterministic success, refund, unknown, partial, expiry, delay, and duplicate scenarios | Explicitly simulated; confidentiality rejected |
| Direct NEAR testnet settlement | configured NEAR testnet RPC; https://docs.near.org/integrations/deposits and https://docs.near.org/integrations/fungible-tokens; `near-api-js` 7.4.0 | User-controlled wallet for signing; public RPC for verification | Adapter complete and disabled until both live flags are true. Verified test asset: `near:testnet:nep141:ctusd.olymight.testnet`, code hash `9ErFRZL31aDUPy6nBfztaCySidVzZsZsoyqP5x9NoM12`. A 1 ctUSD CLI smoke transfer succeeded; app-driven settlement remains to be tested | Require RPC `testnet`, `FINAL`, exact hash/signer/receiver/single action, successful matching receipt/executor, exact amount, and durable hash claim. `ctUSD` additionally requires configured deployed code hash, exact metadata/test-only config, receiver registration, one-yocto `ft_transfer`, and matching NEP-297 event | Testnet NEAR and `ctUSD` have no production value; neither is official USDC, a cross-chain route, 1Click swap, confidential payment, or production payroll |
| NEAR Intents 1Click | `https://1click.chaindefuser.com`; https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request; official SDK 0.1.26 | `X-API-Key` or JWT when configured; server-only | Token discovery, signed dry/wet quote parsing, deposit evidence, and status polling implemented; all external calls disabled by default | Query current asset IDs before quotes; verify provider signature; map `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, and `FAILED`; reject malformed/unknown responses | No public 1Click testnet; dry quotes have a separate read-only flag; wet quote/deposit requires global and adapter live flags; confidential behavior is route-dependent |
| Tidepool community sandbox | `https://www.usetidepool.tech`; https://www.usetidepool.tech/docs/guides/first-swap | No credential; Coffer suppresses configured 1Click credentials | Test-only asset discovery, `INTENTS` dry/wet quotes, wallet-signed `ft_transfer_call` deposit evidence and status polling; no ledger posting | Pinned origin and verifier, runtime response validation, integer amounts, tenant/idempotency binding, exact finalized NEAR call/message verification, append-only observations | Community-operated and unaffiliated; `INTENTS` refunds remain inside the verifier; quote/status signatures remain unverified, so provider `SUCCESS` maps to `UNVERIFIED_SUCCESS` and cannot credit settlement |
| NEAR AI Cloud | `https://cloud-api.near.ai/v1`; https://docs.near.ai/cloud/quickstart | Server-only API key required | Gated CFO adapter implemented and fixture-tested; default remains deterministic local mock; no live call made | Provider timeout/malformed output creates controlled failure metadata and cannot reserve funds; validated output still needs human approval | Adapter sends no tools and uses canonical model/no-aliasing, but model/gateway attestation, TLS binding and exact-byte response signatures are not implemented; every response remains `UNVERIFIED` and no private-inference claim is allowed |
| Native NEAR RPC | `https://rpc.testnet.near.org`; https://docs.near.org/api/rpc/introduction | none for public RPC; user signing required for mutations | Frontend scaffold only | Transaction and receipt outcomes must be checked independently | Public chain; never place payroll data in calls, logs, or events |

The initial asset registry distinguishes fictional `mock:base:usdc` and `mock:near:usdc` (6 decimals), real `near:testnet:native` (24 decimals), real-on-testnet but valueless `near:testnet:nep141:<contract-account-id>` `ctUSD` (6 decimals), and dynamic provider-returned Intents asset IDs. A symbol such as `USDC`, `ctUSD`, or `NEAR` is display metadata, never a canonical identity.

Live read-only revalidation on 2026-11-08 returned 26 Tidepool assets and a
1-USDC dry quote through Coffer's adapter for
`nep141:usdc.tidepool-sandbox.testnet` →
`nep141:wnear.tidepool-sandbox.testnet`. It returned
270,385,915,489,130,447,248,000 atomic wNEAR, a
267,682,056,334,239,142,775,520 minimum, no deposit address, and an explicitly
unverified provider signature. Tidepool documents `POST /v0/quote` as
1Click-compatible; it is still a separate community test environment, not an
official 1Click testnet.

Before enabling a provider, record the live supported region, chain, asset IDs, minimums, fees, quota, expiry, refund address rules, outage behavior, and independently verified reconciliation evidence. Provider text is untrusted input and never directly posts a ledger entry.
