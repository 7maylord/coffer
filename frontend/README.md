# Coffer frontend — Next.js (App Router)

This is Coffer’s business workspace: the interface for verified revenue,
treasury decisions, payroll preparation, policy approvals, finance-agent
evidence, and wallet-authorized payment instructions. It is deliberately a
control surface, not a custodial wallet: the browser requests a reviewed,
canonical action and the connected NEAR wallet is the signer.

NEAR Connect and `near-api-js` provide wallet connectivity and NEP-413 session
authentication. The UI presents the AI CFO’s typed proposals, but policy and
human approval—not model output—determine whether a financial action can move
forward. NEAR Intents asset discovery and quote journeys are proxied through
the backend so provider credentials never enter the browser.

Requires Node.js 22.22.2+ or 24+.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local`, then open http://localhost:3000. Enter
`/demo/overview` for the public synthetic workspace. Canonical routes such as
`/overview` require a backend-issued Coffer session created from a fresh
NEP-413 signature on NEAR testnet. No UI action moves funds by default; the
backend configuration remains mock-only. When the three explicit
testnet flags are enabled, Treasury can ask the verified wallet to sign one
reviewed Tidepool NEP-141 deposit; it never signs automatically.

`COFFER_API_URL` is server-only. Next.js proxies `/api/coffer/*` to that origin,
so the HttpOnly session cookie remains same-origin. Optional Privy support uses
only the public `NEXT_PUBLIC_PRIVY_APP_ID`.
Privy creates an embedded NEAR wallet, but Coffer still authenticates it through
the same backend-verified NEP-413 challenge as any other NEAR Connect wallet.
The Privy dashboard must allow the local/site origin before that flow works.
NEAR Intents credentials and the policy-factory provisioner key belong only in
`backend/.env`; never expose them as `NEXT_PUBLIC_*` values.

- The generated OpenAPI types live in `src/lib/api-schema.d.ts`; `src/lib/coffer-api.ts` validates every consumed response at runtime.
- The Coffer UI lives in `src/components/coffer`, with typed fixtures and exact-cent arithmetic in `src/lib/demo.ts`.
- The original wallet example remains isolated at `/hello-near` and is not part of the Coffer demo.
- The owner treasury route prepares a per-organization factory call, tracks its
  final-chain status, and binds only a backend-verified active instance. It does
  not sign with or receive the sponsor key.
- The authenticated Treasury screen discovers the current Intents provider
  assets, previews a dry quote, persists an executable quote, displays the exact
  token/deposit/amount/deadline, and requests one explicit wallet signature.
  Tidepool results stay testnet/test-only and never credit the Coffer ledger.
- Configure the network and contract addresses in `src/config.ts`.
- `src/providers/near-provider.tsx` supplies the wallet context using NEAR Connect and `near-api-js`. The function call key plugin permits `set_greeting` calls on the configured contract with a limited allowance.

## Testnet wallet integration

The deployed test asset is
`near:testnet:nep141:ctusd.olymight.testnet`. The Tidepool Treasury flow consumes
a backend-created canonical transaction, asks the connected NEAR wallet to sign
that exact `ft_transfer_call` into Tidepool's verifier with the quote deposit
address as `msg`, and returns only the transaction hash for independent backend
verification. No per-quote storage registration is required. It shows provider
completion as unverified and never
marks an invoice or ledger entry paid from a wallet callback alone.

The policy approval UI will similarly submit the backend-generated
`create_proposal`/`approve_proposal` calls to the configured approver wallet.
For the hackathon, `olymight.testnet` and `olumight.testnet` demonstrate two
distinct keys; production requires independently controlled approver wallets.

```sh
pnpm lint
pnpm api:generate
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Run `pnpm start` to serve the production build. Browser tests start their own
local server on port 3100, or reuse it locally if already running.

With a local server on port 3100, `node scripts/capture-design.mjs` captures
the ten public/demo routes plus the API-unavailable sign-in state at desktop
and mobile widths into `../docs/design/screenshots`. See the
[F-07 accessibility audit](../docs/design/f07-audit.md),
[demo script](../docs/demo-script.md),
[submission checklist](../docs/submission-checklist.md),
[ADR-0012](../docs/adr/0012-coffer-interactive-design-demo.md),
[ADR-0013](../docs/adr/0013-near-wallet-authentication.md), and the
[implementation plan](../docs/implementation-plan.md) for integration gaps.

See the [NEAR frontend quickstart](https://docs.near.org/build/web3-apps/quickstart) and [Hello NEAR example](https://github.com/near-examples/hello-near-examples) for more details.

This package is part of Coffer and is distributed under the repository’s
[MIT License](../LICENSE).
