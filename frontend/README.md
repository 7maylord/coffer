# Coffer frontend — Next.js (App Router)

Requires Node.js 22.22.2+ or 24+.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local`, then open http://localhost:3000. Enter
`/demo/overview` for the public synthetic workspace. Canonical routes such as
`/overview` require a backend-issued Coffer session created from a fresh
NEP-413 signature on NEAR testnet. No UI action moves funds.

`COFFER_API_URL` is server-only. Next.js proxies `/api/coffer/*` to that origin,
so the HttpOnly session cookie remains same-origin. Optional Privy support uses
the public `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_PRIVY_APP_CLIENT_ID`.
Privy creates an embedded NEAR wallet, but Coffer still authenticates it through
the same backend-verified NEP-413 challenge as any other NEAR Connect wallet.
The Privy dashboard must allow the local/site origin before that flow works.

- The generated OpenAPI types live in `src/lib/api-schema.d.ts`; `src/lib/coffer-api.ts` validates every consumed response at runtime.
- The Coffer UI lives in `src/components/coffer`, with typed fixtures and exact-cent arithmetic in `src/lib/demo.ts`.
- The original wallet example remains isolated at `/hello-near` and is not part of the Coffer demo.
- Configure the network and contract addresses in `src/config.ts`.
- `src/providers/near-provider.tsx` supplies the wallet context using NEAR Connect and `near-api-js`. The function call key plugin permits `set_greeting` calls on the configured contract with a limited allowance.

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
