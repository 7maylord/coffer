# ADR-0013: NEAR wallet authentication with optional Privy

Date: 2026-11-01

Status: accepted; local implementation complete, live-wallet evidence pending.

Related: ADR-001/002/004; COF-601; F-01; FR-ID-001–004; T-ID-01–08;
Gate G0.

Coffer uses a NEAR account as its primary P0 identity. The frontend requests a
five-minute, single-use challenge from the API and asks a compatible wallet to
perform NEAR Connect's atomic `signInAndSignMessage` flow. The wallet signs a
NEP-413 message containing the API-selected message, 32-byte nonce, recipient
origin, network and state. The API consumes the challenge once, verifies the
signature and the account key against NEAR testnet RPC, and issues the Coffer
session. A submitted account ID alone never authenticates a user.

The session remains Coffer-owned. It uses an HttpOnly, SameSite=Strict cookie;
mutations also require the matching readable CSRF token. Next.js proxies a
same-origin `/api/coffer/*` path to the server-only `COFFER_API_URL`, so no API
credential or provider token enters the browser bundle. Session refresh,
revocation, organization membership and authorization remain server
authoritative. Frontend role guards reduce confusing navigation but are not a
security boundary.

Privy is an optional wallet provider, not a second Coffer authentication
authority. When both public Privy client identifiers are configured, the app
loads `@privy-io/react-auth` 3.51.0, creates a Privy NEAR wallet through the
extended-chains API when required, and registers
`@peerfolio/privy-near-connect` 0.0.8 with NEAR Connect 0.11.4. That wallet must
sign the same NEP-413 challenge and pass the same backend verification as an
external NEAR wallet. The signing popup accepts requests only from its own
origin, diagnostic payload logging stays disabled, and its executor URL is
pinned to immutable commit
`3d56b782669d242a1ea432921e291abc26b4ebc7`.

This follows the current official [NEAR wallet login
guide](https://docs.near.org/web3-apps/tutorials/wallet-login), [NEAR Privy
integration guide](https://docs.near.org/web3-apps/tutorials/privy), and
[`near-api-js` message verification
guidance](https://docs.near.org/tools/near-api#validate-message-signatures),
checked on 2026-11-01. Provider behavior can change and must be rechecked before
deployment.

The public demo moved to `/demo/*` and remains explicitly synthetic. Canonical
workspace routes now show loading, anonymous, API-unavailable, organization
setup, forbidden and authenticated states. Automated Chromium coverage proves
logged-out, unavailable, revoked/expired, CSRF organization creation, CSRF
logout and role-denial behavior on desktop and mobile. No Privy application
credentials or interactive wallet were available locally, so the real popup,
testnet RPC verification from a browser-signed challenge, and provider
dashboard origin configuration remain manual release evidence. No transaction,
access key or fund movement is part of sign-in.
