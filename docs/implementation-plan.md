# Coffer contract-first implementation plan

- Status: executing; local backend and F-01 through F-07 code-owned implementation complete, release gates remain open
- Date: 2026-11-02
- Source of truth: `COFFER_PRD_TRD.md`
- Required order: contracts, then backend, then frontend
- Scope: hackathon P0 through Gates G0-G5; P1/P2 remain separately gated

## 1. Outcome and sequencing rule

Official rules refreshed 2026-10-28 from https://nearhackathon.com/HACKATHON.md.
`HACKATHON.md` is an unmodified copy. Eligible work starts October 19; the
November 14 23:59 UTC deadline is unchanged. All tracks permit testnet-only
projects. Local-only demos need a reproducible public repository, LICENSE,
and an X video; hosting is optional. Intents has no testnet. No repository
publication, X post, submission, deployment, or mainnet transfer is authorized
by this refresh. README provenance/baseline and license selection remain
submission checklist tasks.

Implementation proceeds in three strict product phases:

1. Complete two independently deployable NEAR contracts: the non-custodial policy and approval commitment contract, then the test-only NEP-141 `ctUSD` contract.
2. Complete the backend and worker behavior against stable contract and OpenAPI boundaries.
3. Replace the generated frontend with the complete user journeys after the backend API is stable.

The contract is an additional authorization proof, not Coffer's ledger or payment executor. It records organization, policy, proposal, revision, expiry, and approval commitments. It never stores salaries, names, invoice contents, recipients, raw amounts, wallet secrets, or provider credentials. It never receives treasury funds, calls NEAR Intents, or signs a transfer.

This ordering changes the PRD's default critical path while preserving ADR-002 through ADR-006. The justification is narrow: an on-chain quorum commitment gives reviewers a public proof that distinct eligible NEAR accounts approved the exact proposal digest. The server still re-evaluates policy and authorization immediately before any external effect.

## 2. Current baseline

| Area           | Current state                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gap before product-complete                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts      | Official `cargo near new` packages exist at `contracts/near-policy` and `contracts/test-token`; policy C-01 through C-05 and test-token C-08 are implemented and locally tested; C-06/C-09 are partial                                                                                                                                                                                                                                                                             | Complete reproducible artifacts and independent review; nothing is deployed                                                                          |
| Backend        | B-01 through B-11 are complete for the local automated implementation: foundation safety, identity/tenancy, exact money and ledger reservations, deterministic policy/proposals, durable settlement/reconciliation, invoices, independently verified testnet evidence, guarded 1Click discovery/quotes/status, typed CFO suggestions, policy-governed mock agent commerce, encrypted synthetic payroll, hash-chained audit/operator operations, and the resilience/regression gate | Independent human security review remains required before COF-602 can be closed as a release gate                                                    |
| Frontend       | Interactive Coffer design plus F-01 authenticated NEAR/Privy sessions, F-02 authoritative invoice-to-mock-settlement, F-03 authoritative treasury/policy approval, F-04 evidence-bound automation, F-05 encrypted synthetic payroll, F-06 authoritative operations/audit, and F-07 responsive/accessibility/evidence hardening                                                                                                                                                    | Manual screen-reader/Safari/Firefox and hosted-CI evidence remain open; real wallet/Privy, deployed-contract, live NEAR AI attestation, fresh approval-signature and real-transfer evidence remain absent |
| Infrastructure | PostgreSQL and Redis Compose, separate frontend/backend pnpm projects, transactional migrations, worker/concurrency tests, contract artifact checks, credential and dependency scans, type-aware linting, critical-test manifest, coverage gate, security regression, performance smoke, and frontend Chromium tests configured in CI                                                                                                                                              | Hosted CI execution and full-stack product journey gates remain unverified                                                                           |

The `START_HERE.md` local foundation record is complete for its stated scope. The backend portion of Gate G0 is green for current routes. A frontend demo Playwright baseline now passes locally; full PRD Gate G0 remains open for authenticated frontend/backend integration. Resource-specific T-ID-05/06/07 frontend cases remain part of the integration work.

## 3. Locked architecture and safety decisions

### 3.1 Policy contract boundary

The authorization contract is `contracts/near-policy`. Its purpose is to make an approved proposal revision and its distinct human approvals independently verifiable.

The contract stores:

- a fixed-size organization commitment, never a customer name or database ID in plaintext;
- organization controller and eligible NEAR approver account IDs;
- approval threshold, frozen state, policy digest, and configuration version;
- proposal ID digest, revision, canonical instruction digest, policy digest, expiry, proposer, state, and distinct approvals;
- bounded structured events containing identifiers, digests, versions, and state only.

The policy contract does not store or move fungible tokens. Any storage deposits are accounted for separately and cannot be treated as treasury assets. Adding NEP-141 transfers, Chain Signatures, cross-contract calls, upgrade execution, or asset custody to `near-policy` reopens architecture and audit review.

### 3.2 Test-token boundary

`contracts/test-token` is a separate test-only NEP-141 contract named **Coffer Test Dollar** with symbol `ctUSD` and six decimals. It implements NEP-141 transfers, NEP-145 storage management, NEP-148 metadata, and NEP-297 standard events using current audited ecosystem components where possible. A bounded issuer-only mint method exists only for Sandbox/testnet fixtures.

`ctUSD` has zero monetary value, is never called USDC, and is never entered into the Intents adapter unless the exact contract asset ID is independently returned by the current provider token endpoint. Its canonical registry identity is `near:testnet:nep141:<contract-account-id>`, never its symbol. The test-token contract has no payroll, policy, approval, treasury, swap, bridge, or Intents logic.

The two Cargo packages remain independently buildable inside `contracts`; neither is part of the frontend or backend pnpm project. No root Rust package deploys both contracts together.

### 3.3 Canonical proposal digest

Rust, backend TypeScript, and frontend display must use one byte-level digest specification with domain separation such as `coffer:proposal:v1`. The schema binds at least:

- organization commitment;
- proposal type and stable proposal ID;
- revision and policy version/digest;
- asset and chain IDs;
- exact atomic amount string and authorized maximum;
- recipient commitment;
- expiry, nonce, and idempotency reference;
- intended operation and environment.

The implementation must publish golden vectors and prove Rust/TypeScript parity. Free-form JSON, display amounts, symbols, AI text, and frontend-generated hashes are not authorization inputs.

### 3.4 Authorization model

- Direct caller authorization uses `predecessor_account_id`; original signer checks are added only when the rule explicitly concerns the transaction signer.
- Approval and sensitive configuration calls require a deposit-capable wallet proof and reject duplicate approvers.
- A material proposal change creates a new revision/digest and invalidates prior approvals.
- Expired, cancelled, frozen, or stale-policy proposals cannot reach quorum.
- Bootstrap configuration is explicit; later approver/threshold/policy changes use the current quorum rather than unilateral server authority.
- Backend RBAC and on-chain eligibility are both required when the contract feature is enabled.

### 3.5 Storage, privacy, and upgrade posture

- All input strings, collections, approver counts, active proposals, and page sizes are bounded.
- Storage accounting is explicit and covered by Sandbox tests; callers cannot force the contract account to subsidize unbounded state.
- Contract events follow NEP-297 structure and contain no PII or raw financial instruction.
- State is versioned from V1 and includes a tested migration hook before any upgrade path is enabled.
- P0 ships no public self-upgrade method. Testnet deployment and any future upgrade require an artifact hash, account/network confirmation, and separate owner authorization.

## 4. Phase C — contracts complete first

Phase C relates to ADR-005, ADR-0004, FR-POL-001 through FR-POL-003, FR-APR-001 through FR-APR-002, FR-AUD-001 through FR-AUD-002, FR-PRV-005, FR-PAY-003/007, COF-203, COF-301, COF-302, Gates G3-G4, and PRD sections 7.1-7.3 and 8.

Progress snapshot on 2026-10-28:

- **C-01 complete locally:** commitment-only ABI, state boundary, digest spec,
  golden vector, privacy inventory, and structured event schema are present.
- **C-02 complete locally:** bounded approvers, current-quorum configuration,
  freeze state, distinct approvals, and immutable applied/cancelled history pass
  unit tests.
- **C-03 complete locally:** proposal create/approve/cancel/expire/query behavior,
  revision identity, expiry, stale-policy denial, and bounded pagination pass
  unit tests.
- **C-04 complete locally:** storage growth is charged, exact excess-deposit refunds are
  asserted from the generated transfer receipt, histories/pages have hard
  bounds, events are redaction-tested, and an explicit legacy V0-to-V1 fixture
  preserves configuration, history, proposals, and approvals while rejecting
  V1 bytes as legacy input.
  Sandbox rejects storage underpayment and proves the contract does not retain
  a one-NEAR overpayment beyond storage stake and protocol gas rewards. Unit
  quota fixtures exhaust and reject both 1,024 configuration records and 10,000
  proposal records before an additional write.
- **C-05 complete locally; C-06 partial; C-07 open:** multi-account Sandbox deployment,
  outsider denial, storage underpayment, excess refund, pre-expiry denial,
  permissionless post-expiry finalization, atomic low-gas failure without state,
  duplicate approval denial, and
  distinct-approver proposal/configuration quorum pass. A local locked policy
  WASM/ABI build, checksum, ABI privacy scan, TypeScript interface/digest parity
  fixture, and internal security
  review are recorded. The reproducible release artifact and independent review
  are outstanding.
  `cargo near build reproducible-wasm` currently stops before Docker because the
  workspace has no Git repository/HEAD; repository initialization remains outside
  this contract slice.
- **C-08 complete locally:** `near-contract-standards 5.29.1` is locked; NEP-141,
  NEP-145, NEP-148, NEP-297, one-yocto issuer minting, maximum supply, and input
  bounds pass unit tests and internal review.
- **C-09 partial:** local WASM/ABI/checksum evidence, an approval-gated non-executed
  testnet runbook, and Sandbox registration/unauthorized-mint/exact-transfer/
  resolver-refund/unregistration evidence are recorded. Unit receipt assertions
  prove exact excess registration refunds, and Sandbox proves unforced positive-
  balance rejection plus forced burn/unregistration. Concurrent-call evidence
  now includes simultaneous independent signers transferring to one receiver,
  with exact final balances and unchanged total supply;
  a reproducible release build remains open.

| Ticket | Work                                                                                                                                                                                         | Tests and evidence                                                                                                                                              | Exit dependency   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| C-01   | Replace auction terminology and write the contract interface, state V1, canonical digest specification, error codes, event schema, and privacy inventory                                     | Golden digest fixtures; ABI/API review; prove no sensitive fields exist                                                                                         | ADR-0002 accepted |
| C-02   | Implement organization registration, controller/approver set, threshold, policy digest, freeze state, and quorum-governed configuration revisions                                            | Unauthorized registration/update; invalid threshold; duplicates; freeze; stale configuration                                                                    | C-01              |
| C-03   | Implement proposal commitment lifecycle: create, approve, cancel, expire, query, and bounded pagination                                                                                      | T-CON-01 through T-CON-10 below                                                                                                                                 | C-02              |
| C-04   | Implement storage accounting, collection bounds, state versioning, structured events, and migration test fixture                                                                             | Storage growth/refund accounting, quota exhaustion, migration, event redaction                                                                                  | C-03              |
| C-05   | Replace auction Sandbox tests with multi-account end-to-end tests and adversarial cases                                                                                                      | Local NEAR Sandbox only; no testnet deployment required                                                                                                         | C-04              |
| C-06   | Produce locked WASM/ABI artifacts, artifact checksum, TypeScript contract interface fixture, README, threat model update, and CI checks                                                      | `cargo fmt --check`, Clippy with warnings denied, unit tests, Sandbox tests, `cargo near build non-reproducible-wasm --locked`, reproducibility metadata review | C-05              |
| C-07   | Independent contract security review against current NEAR checklist                                                                                                                          | Every public method reviewed; caller identity, deposits, storage, overflow, events, migration, and privacy signed off                                           | C-06              |
| C-08   | Replace the second generated tutorial with test-only NEP-141 `ctUSD`: six decimals, NEP-145 registration, NEP-148 metadata, NEP-297 events, owner-only bounded mint, no policy/Intents logic | T-FT-01 through T-FT-08; standard interface and metadata review                                                                                                 | C-01              |
| C-09   | Add `ctUSD` Sandbox tests, locked WASM/ABI, checksum, README, and testnet deployment runbook without executing it                                                                            | Registered transfers/refunds, exact amounts, unauthorized mint denial, artifact checks                                                                          | C-08              |

Contract test IDs introduced by this plan:

- **T-CON-01:** one account cannot satisfy a 2-of-N quorum twice.
- **T-CON-02:** changed instruction, recipient commitment, amount, expiry, policy digest, or revision cannot reuse approvals.
- **T-CON-03:** unauthorized or removed account cannot create, approve, cancel, freeze, or update configuration.
- **T-CON-04:** expired, cancelled, frozen, and stale-policy proposals never become approved.
- **T-CON-05:** organization and proposal identifiers cannot collide across organizations.
- **T-CON-06:** unbounded strings, collections, pagination, duplicate approvers, and invalid thresholds are rejected before state change.
- **T-CON-07:** storage growth is paid and bounded; insufficient storage balance fails without partial state.
- **T-CON-08:** events and state contain no salary, name, invoice body, raw recipient, or free-form AI/provider text. This is the contract proof for T-PRV-10.
- **T-CON-09:** V1 state migration preserves configuration, proposals, and approvals exactly.
- **T-CON-10:** Rust and TypeScript golden vectors produce the same proposal digest.

Test-token IDs introduced by this plan:

- **T-FT-01:** metadata is exactly `Coffer Test Dollar`, `ctUSD`, six decimals, and explicitly test-only.
- **T-FT-02:** unregistered receivers cannot receive `ctUSD`; NEP-145 registration charges/refunds storage correctly.
- **T-FT-03:** `ft_transfer` requires one yoctoNEAR and moves the exact integer atomic amount.
- **T-FT-04:** `ft_transfer_call` resolves unused amounts once and cannot over-refund.
- **T-FT-05:** only the configured test issuer can mint, and the bounded maximum supply cannot be exceeded.
- **T-FT-06:** unauthorized mint, overflow, zero-value misuse, malformed memo, and insufficient balance fail without partial state.
- **T-FT-07:** mint, burn, and transfer emit standard events without PII or misleading USDC metadata.
- **T-FT-08:** the deployed contract ID, network, decimals, and transaction evidence must match the canonical asset registry entry.

### Contract completion gate C0

Backend feature work does not begin until all of the following are true:

- generated auction code and tests are absent from both active contract packages;
- all policy and test-token unit and Sandbox tests pass;
- both WASM files build from locked dependency graphs and their checksums are recorded;
- `near-policy` has no treasury transfer, fungible-token transfer, Intents, Chain Signatures, payroll, or arbitrary callback method;
- `test-token` contains only standard test-asset behavior and bounded issuer minting, with no treasury, policy, payroll, bridge, swap, or Intents behavior;
- every public method has an explicit caller and deposit policy;
- storage, bounds, migration, events, privacy, and digest parity are tested;
- ABI/interface and contract README are stable enough for the backend adapter;
- an independent review finds no unresolved critical/high issue.

Testnet deployment is not part of C0. It is a separately authorized validation action after C0.

## 5. Phase B — backend complete second

The backend remains one independent pnpm project. API, worker, pure domain modules, and infrastructure adapters live under `backend`; no root workspace or shared frontend package is reintroduced.

| Ticket | Related PRD work                           | Implementation slice                                                                                                                                                                                                                                                                                                           | Required tests / exit evidence                                                                                                                                                                                                                               |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-01   | COF-003, COF-004, G0                       | Correlation IDs, safe error envelope, redaction, complete env validation, liveness/readiness, OpenAPI generation, security/secret/SAST CI                                                                                                                                                                                      | Log capture contains no secrets; unsafe feature combinations fail startup                                                                                                                                                                                    |
| B-02   | COF-101; FR-ID-001-004                     | NEP-413 challenge authentication, sessions, wallet links, organizations, invites, RBAC, tenant-scoped repositories                                                                                                                                                                                                             | T-ID-01 through T-ID-08; cross-tenant 403/404                                                                                                                                                                                                                |
| B-03   | COF-102, COF-103; FR-TRE-001-003           | Exact money and asset registry, journal accounts/transactions/lines, reservations, deterministic split, reversals, serializable locking                                                                                                                                                                                        | T-LED-01 through T-LED-07, including concurrent reservations                                                                                                                                                                                                 |
| B-04   | COF-301, COF-302, COF-303; FR-POL/FR-APR   | Deterministic policy engine, immutable proposals, off-chain approval records, contract digest library, NEAR contract read/call adapter, quorum/finality verification                                                                                                                                                           | T-POL-01 through T-POL-06 plus T-CON-10 parity; fail closed on RPC/contract mismatch                                                                                                                                                                         |
| B-05   | COF-104, COF-202; FR-PAY-001/002/004-007   | PostgreSQL settlement repository, durable idempotency, observations, refund and one-time posting, transactional outbox/inbox, Redis worker, reconciliation queue                                                                                                                                                               | T-PAY-02 and T-PAY-04 through T-PAY-12; 100 concurrent events produce one posting                                                                                                                                                                            |
| B-06   | COF-201; FR-INV-001-003                    | Invoice and line-item state machine, redacted public token page API, payment attempts, verified settlement-to-paid transition                                                                                                                                                                                                  | J-01 API E2E; unknown/underfunded/refunded cannot mark paid                                                                                                                                                                                                  |
| B-07   | COF-203, COF-204; FR-PAY-003/007           | Add `NearTestnetTransferAdapter` for real wallet-signed native testnet NEAR and registered `ctUSD` NEP-141 transfers with independently verified RPC finality; add current 1Click token discovery, dry/wet quote adapter, sanitized contract fixtures, status mapping, deposit evidence and polling behind separate live flags | Testnet transaction hash cannot be replayed; signer/receiver/amount/network/native action or exact FT contract call/final receipts must match; provider contract tests cover every documented 1Click status and malformed response; no routine live transfer |
| B-08   | COF-401-403; FR-AI-001-004, FR-AGT-001-004 | Typed CFO proposals, scoped data, provider-neutral AI adapter, whitelisted mock vendor, offer digest, bounded agent purchase through central policy                                                                                                                                                                            | T-AI-01 through T-AI-05; T-AGT-01 through T-AGT-06                                                                                                                                                                                                           |
| B-09   | COF-501, COF-502; FR-PRV-001-005           | Strict synthetic CSV import, envelope encryption metadata, payroll manifest/version, self-only payslip service, private-analysis adapter and attestation verifier                                                                                                                                                              | T-PRV-01 through T-PRV-10; strict mode blocks unverified inference                                                                                                                                                                                           |
| B-10   | FR-AUD-001-003; G2/G4                      | Append-only audit, operator settlement dashboard API, reconciliation actions, metrics, seed fixtures, full OpenAPI and demo reset                                                                                                                                                                                              | J-01 through J-05 API-level flows; audit access and redaction tests                                                                                                                                                                                          |
| B-11   | COF-602                                    | Full backend resilience, concurrency, migration, dependency, security, and performance smoke gate                                                                                                                                                                                                                              | ≥80% backend lines, ≥90% critical branch coverage, every named critical test explicit                                                                                                                                                                        |

Backend implementation order is B-01 -> B-02 -> B-03 -> B-04 -> B-05 -> B-06 -> B-07 -> B-08/B-09 -> B-10 -> B-11. B-08 and B-09 may be developed independently only after B-04 and must not edit the same migration concurrently.

### Backend completion gate B0

- contract digest parity and contract-state verification are stable;
- all financial state is durable and transactionally consistent;
- authz and tenant isolation cover every repository and endpoint;
- the mock provider uses the same durable lifecycle as the live adapter;
- no callback or provider response can directly post settlement;
- all P0 REST endpoints are versioned in generated OpenAPI;
- migrations apply to an empty database and upgrade the current database;
- unit, integration, E2E, provider-contract, concurrency, security, and build checks pass;
- no unresolved critical/high vulnerability or sensitive log fixture remains.

Wallet-signed testnet transfers, live 1Click execution, real NEAR AI calls, testnet contract deployment, and email sending remain disabled unless separately approved.

## 6. Phase F — frontend complete last

The frontend consumes the stable OpenAPI and contract interfaces. It never receives provider JWTs, encryption keys, payroll plaintext outside an authorized response, or a general-purpose signing key.

| Ticket | Related requirements      | Screens and behavior                                                                                                                                                        | Required tests / evidence                                                             |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| F-01   | COF-601; FR-ID-001-004    | Coffer layout, navigation, design tokens, generated typed API client, NEAR wallet challenge login, session and role guards                                                  | Logged-out, expired, revoked, and forbidden states; accessibility baseline            |
| F-02   | J-01; FR-INV/PAY          | Invoice list/editor/issue flow, redacted hosted invoice, quote review, wallet authorization, settlement timeline, refund/unknown/underfunded states                         | Invoice-to-mock-settlement Playwright path; no success before reconciliation          |
| F-03   | J-02/J-04; FR-POL/APR/TRE | Treasury balances with verified/simulated labels, policy decisions, immutable proposal diff, 2-of-N wallet approval, contract digest/explorer evidence, deterministic split | Duplicate signer, edited revision, expiry, deny, RPC failure, and quorum UX           |
| F-04   | J-03; FR-AI/AGT           | CFO proposal review, evidence links, adversarial-input warning, agent policy, structured vendor offer and controlled purchase                                               | Malformed model/vendor output cannot alter destination or amount                      |
| F-05   | J-05; FR-PRV              | Synthetic payroll import, finance review, private-analysis verification badge, manifest approval, employee self-only payslip                                                | Cross-role/cross-tenant denial; no salary in URL, telemetry, error, or public content |
| F-06   | FR-AUD-003                | Operator settlement/reconciliation dashboard and audit timeline with safe filters and status explanations                                                                   | Pending/stuck/refunded/unknown flows and manual reconcile authorization               |
| F-07   | COF-601-603; G4/G5        | Responsive/a11y polish, truthful mock/live/private labels, empty/loading/error states, demo seed/reset, screenshots and evidence table                                      | J-01 through J-05 Playwright; no critical accessibility issue                         |

### Design checkpoint — 2026-10-31

The requested website design is complete as an interactive local demo (ADR-0012).
This does not close F0 or any complete F-01–F-07 ticket. All ten pages share a
warm editorial design, original CSS/SVG illustrations, responsive navigation,
keyboard-accessible controls and reduced-motion support. The landing sculpture
responds to the pointer and has keyboard/click-selectable nodes.

| Ticket | Implemented and locally exercised                                                                                                                                                                                                                                                                               | Still unimplemented or unverified                                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01   | Landing, workspace shell, navigation/search, settings, mobile menu, demo labels                                                                                                                                                                                                                                 | Generated API client, NEAR login, sessions, organization membership and role guards; T-ID frontend cases                                                                                              |
| F-02   | Synthetic invoice list, exact-cent draft validation, filtering, preview, CSV export and empty state                                                                                                                                                                                                             | Real issuance, hosted invoice, token/chain quotes, signer authorization, reconciliation and payment recovery; J-01                                                                                    |
| F-03   | Canonical treasury and approval routes now use authoritative tenant ledger accounts, fixed server-derived 50/30/20 commitments and remainder, versioned policy, immutable revision diffs, distinct-person quorum, expiry/rejection, final verification and idempotent internal reservation                      | Fresh per-approval wallet signatures, a deployed/configured policy-contract browser run, PostgreSQL HTTP integration for the wrapper routes, real custody evidence and any transfer remain unverified |
| F-04   | Canonical CFO route now shows scoped invoice evidence, provider/model/attestation truth, strict allocation bounds and human reserve decisions. Canonical agents route shows fixed authority, backend budgets, normalized offers, central-policy binding, distinct-person quorum and controlled mock fulfillment | Live NEAR AI attestation/signature verification, fresh approval signatures, external vendor fulfillment, real settlement and any live/deployed evidence remain absent                                 |
| F-05   | Canonical finance import/review, bounded encrypted batch discovery, deterministic/private-analysis truth states, exact manifest approval, and authenticated employee self-only payslips                                                                                                                         | Live verified NEAR AI inference is unavailable; auditor batch discovery/export remains API-only; real payroll and payout privacy remain prohibited                                                    |
| F-06   | Canonical bounded settlement queues, pending/stuck/refunded/completed states, metrics, exact-event filtering, hash-chain integrity evidence, pagination and authorized idempotent recheck                                                                                                                       | No live provider reconciliation or automated remediation; broad search/export and retained operator preferences remain out of scope                                                                   |
| F-07   | Responsive pages through 320 px, motion preference, dialog focus containment/return, Escape dismissal, local reset, 22 inspected screenshots, API-unavailable recovery, and automated axe WCAG A/AA checks across all public/demo routes                                                                                   | Independent security review, manual screen-reader/Safari/Firefox, hosted CI, final fresh-install verification, video/public-repo/X/submission actions, and live/deployed evidence                       |

The browser suite checks all ten routes for runtime errors, external service
requests and horizontal overflow, plus invoice/export, allocation/review,
CFO/agent/payroll, settings/reset and keyboard/motion interactions on desktop
and emulated mobile Chromium. These are demo UI tests, not proof of backend
authorization, financial execution or full accessibility conformance.

Workspace state stays in React memory and resets on reload. All balances and
people are synthetic. Display masking is explicitly not encryption, the CFO
is a deterministic preview, and review actions neither sign nor move funds.
The legacy wallet example is isolated at `/hello-near`; the ten demo routes
make no external service calls. OpenAPI is unchanged because no API changed.

### Frontend completion gate F0

- all five canonical journeys work against the completed backend with synthetic data;
- wallet rejection, network mismatch, expired session, stale proposal, provider outage, and unknown settlement have usable recovery states;
- every financial review shows atomic-source values formatted safely, recipient/chain/asset, expiry, policy result, and approval state;
- mock, dry quote, testnet contract, verified private inference, and live settlement are visually and semantically distinct;
- responsive, keyboard, focus, label, contrast, and screen-reader checks pass;
- no secret or server credential appears in the browser bundle.

## 7. Final integration and release gates

| Gate | Evidence                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0   | Complete auth, tenant denial, redaction, CI, migrations, health, secret scanning, SAST, and Playwright baseline                                                                                                                                                                                                                             |
| G1   | Durable ledger, idempotency, policy, settlement, outbox worker, reconciliation, and concurrency tests                                                                                                                                                                                                                                       |
| G2   | J-01 invoice -> proposal/authorization -> mock settlement -> reconciliation -> ledger -> UI passes E2E                                                                                                                                                                                                                                      |
| G3   | Real testnet proof may use the native policy contract plus a wallet-signed native testnet NEAR or `ctUSD` NEP-141 transfer, clearly labeled with its exact test asset and contract. Current 1Click provider preflight and dry quote remain separate; any low-value mainnet transfer requires an owner-approved runbook and manual signature |
| G4   | J-02 through J-05, contract quorum proof, negative security demos, and honest privacy evidence                                                                                                                                                                                                                                              |
| G5   | Fresh installs for frontend/backend/contracts, full CI, architecture/demo docs, screenshots/video, public repository and submission actions completed by an authorized human                                                                                                                                                                |

## 8. Suggested hackathon schedule

The official build window is November 1-14, 2026. Pre-build work through October 31 remains planning, research, fixtures, and acceptance design.

| Date      | Target              | Exit                                                                                                               |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Nov 1-3   | Phase C             | Policy and test-token Gate C0 green; no deployment                                                                 |
| Nov 4     | B-01/B-02           | G0 auth and tenant boundary green                                                                                  |
| Nov 5-6   | B-03/B-04           | Ledger, policy, approvals, and contract verification green                                                         |
| Nov 7-8   | B-05/B-06           | Durable invoice-to-mock settlement API vertical slice green                                                        |
| Nov 9     | B-07                | Direct NEAR testnet adapter and 1Click dry/provider contract adapter green; every signing mode disabled by default |
| Nov 10    | B-08/B-09/B-10      | AI/agent/payroll/audit API scenarios green or explicitly reduced to honest fallback                                |
| Nov 11-12 | F-01 through F-06   | Complete frontend journeys against stable API                                                                      |
| Nov 13    | F-07 and regression | G2/G4, accessibility, resilience, and fresh-install evidence green                                                 |
| Nov 14    | G5 freeze           | Documentation and owner-controlled submission assets only                                                          |

If schedule pressure appears, reduce P1 integrations and demo breadth. Do not remove tenancy, ledger balancing, idempotency, policy re-checks, reconciliation, privacy isolation, or contract negative tests.

## 9. Human decisions and approval gates

The plan recommends NEP-413 wallet challenge as the P0 primary identity because contract approval already requires NEAR accounts. This decision should be recorded before B-02 starts.

The following are never implied by approval of this plan:

- deploying the contract to testnet or mainnet;
- creating/funding a wallet or storing a seed phrase;
- signing or submitting a native NEAR testnet payment;
- deploying, minting, registering, or transferring testnet `ctUSD`;
- enabling `LIVE_TRANSFERS_ENABLED`;
- performing a 1Click mainnet deposit;
- using real payroll or customer data;
- calling NEAR AI with sensitive data or purchasing credits;
- sending email, publishing a repository, posting to X, or submitting the hackathon.

Each requires its own concrete, reviewable preflight and authorization where applicable.

## 10. Current official NEAR references

- Contract security checklist: https://docs.near.org/smart-contracts/security/checklist
- Callback access control: https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks
- Transaction and receipt execution: https://docs.near.org/protocol/transactions/transaction-execution
- Storage staking: https://docs.near.org/protocol/storage/storage-staking
- Access and function-call keys: https://docs.near.org/protocol/accounts-contracts/access-keys
- One yoctoNEAR ownership proof: https://docs.near.org/smart-contracts/security/one_yocto
- Rust unit and integration testing: https://docs.near.org/smart-contracts/testing/unit-test and https://docs.near.org/smart-contracts/testing/integration-test
- NEP-297 events: https://github.com/near/NEPs/blob/master/neps/nep-0297.md
- NEP-141 fungible tokens: https://docs.near.org/integrations/fungible-tokens
- NEP-145 storage management: https://docs.near.org/primitives/ft/standard#nep-145-storage-management
- NEAR Intents quickstart and no-testnet limitation: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction

Provider schemas and versions must be rechecked through official documentation before B-07, B-09, G3, or any deployment.

## 11. 1Click-unavailable fallback

1Click has no public testnet. Coffer therefore uses three explicitly different settlement modes:

| Mode           | Purpose                               | What it proves                                                                                                                                                                                   | What it does not prove                                                                              |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `mock`         | Default local/demo mode               | Complete state machine, idempotency, refunds, duplicates, delays, underfunding, unknown/reconciliation, and ledger behavior                                                                      | Any chain transaction or provider availability                                                      |
| `near-testnet` | Optional owner-approved demonstration | Real user wallet authorization, native NEAR or registered `ctUSD` testnet transfer, RPC/receipt finality verification, recipient/amount/contract matching, replay prevention, and reconciliation | Real stablecoin value, cross-chain routing, 1Click behavior, production liquidity, or legal payroll |
| `near-intents` | Disabled provider mode                | Current token/route discovery and dry quote; a mainnet transfer only after separate approval                                                                                                     | Public testnet behavior, because 1Click does not provide it                                         |

For `near-testnet`, the backend creates a canonical payment instruction and the frontend asks the payer or employer wallet to sign either a direct native NEAR transfer or an `ft_transfer` call to the configured `ctUSD` contract after NEP-145 registration. The backend accepts the transaction hash as untrusted evidence, retrieves the transaction and all relevant receipt outcomes from the configured testnet RPC, and settles only after finality and exact signer, receiver, amount, network, action/token contract, instruction, and replay checks pass. Payroll creates one independently reconciled attempt per recipient.

Native testnet NEAR and `ctUSD` must be labeled as valueless testnet evidence. Neither may be presented as USDC, real stablecoin value, a 1Click swap, a confidential payment, or production payroll. `ctUSD` is enabled only after its contract ID, six-decimal metadata, registration behavior, artifact checksum, and issuer controls are verified and recorded in the provider matrix.

### 11.1 Multi-adapter and multi-asset registry

All three adapters can be enabled in the same demo through a typed adapter registry. `SETTLEMENT_MODE=mock` remains the safe default, while adapter-specific feature flags control whether testnet signing, Intents dry quotes, or live execution are available. Selecting an adapter for one payment never enables another adapter or bypasses its gate.

| Asset ID                                    | Adapter        |          Decimals | Meaning                                                                                                     |
| ------------------------------------------- | -------------- | ----------------: | ----------------------------------------------------------------------------------------------------------- |
| `mock:base:usdc`                            | `mock`         |                 6 | Fictional Base-like USDC used only by the simulator                                                         |
| `mock:near:usdc`                            | `mock`         |                 6 | Fictional NEAR-like USDC used only by the simulator                                                         |
| `near:testnet:native`                       | `near-testnet` |                24 | Real native testnet NEAR transferred by a user-controlled wallet                                            |
| `near:testnet:nep141:<contract-account-id>` | `near-testnet` |                 6 | Real on-chain test transfer of valueless Coffer Test Dollar (`ctUSD`)                                       |
| Provider-returned `assetId`                 | `near-intents` | Provider metadata | Current mainnet-capable asset discovered from 1Click; dry quote unless live execution is separately enabled |

Every asset record includes adapter, environment, network/chain, canonical asset ID, symbol, decimals, native or token kind, optional verified token contract, and mock status. Symbols are display metadata and never identify an asset. All JSON amounts are decimal integer strings in the asset's atomic units; the ledger balances independently per asset.

The backend rejects:

- a mock asset submitted to the testnet or Intents adapter;
- native testnet NEAR represented with USDC decimals or symbol semantics;
- `ctUSD` whose stored contract account, network, six decimals, or code/artifact identity does not match the registry;
- testnet NEAR or `ctUSD` submitted to the Intents adapter;
- an Intents asset ID that was not returned by the current supported-token response;
- a quote, approval, transaction hash, or settlement observation from a different adapter/environment;
- cross-asset ledger balancing or implicit conversion by symbol;
- a payment attempt whose stored asset metadata changed after quote or approval.

The frontend displays persistent `MOCK`, `TESTNET`, `DRY QUOTE`, or `LIVE` badges and shows the network, asset, token contract when applicable, atomic/display amount, adapter, and evidence source. Mock USDC may be used for invoice and payroll workflow demonstrations. Real testnet proof uses a separately denominated native testnet NEAR or `ctUSD` invoice/payroll batch; it is not presented as conversion of the mock USDC amount.

Migration evidence limitation: V0 is a synthetic fixture, not a historical or
deployed contract layout. The conversion test does not certify any real upgrade;
a future upgrade must retain and test the exact deployed source layout.

## Contract-to-backend handoff

The owner requested completion of local contract work and progression to backend.
The remaining refund/unregistration interleavings now have VM tests for both
sender and receiver removal; exact supply and balances remain zero after refund
resolution. These are VM tests, not a Sandbox scheduling proof.

Local contract implementation is handed off to backend. C-06/C-09 reproducible
release evidence and C-07 independent review remain release gates, not claimed
complete. Git remains deferred. This updates the earlier C0 sequencing rule:
backend development may proceed against the tested interfaces while deployment
and release remain gated. Synthetic V0 migration is not a deployed upgrade proof.

B-01 is complete locally (COF-003/004, ADR-004, G0 foundation): feature flags
accept only literal `true`/`false`; unsafe combinations fail startup; generated
correlation IDs, safe error envelopes, allowlisted request logs, dependency
readiness, generated OpenAPI 3.1, type-aware linting, dependency audit, and a
high-confidence credential marker scan are in CI. Error and log tests prove that
exception text, authorization headers, cookies, query values, tenant path values,
and submitted payroll-like fields are not exposed.

Current local evidence after B-02: 88 unit tests pass with 93.5% statements,
86.8% branches, 90.75% functions, and 93.62% lines; six PostgreSQL/Redis
integration tests and seven HTTP E2E tests pass. Strict typecheck, lint,
formatting, generated OpenAPI check, dependency audit, production build, and
credential/artifact scans pass. G0 remains open for the later frontend
Playwright baseline. The source credential scan is
deliberately limited to high-confidence key formats; it complements review and
provider-side secret controls rather than proving that arbitrary sensitive data
cannot be committed.

B-02 identity and tenancy foundations are complete for current routes (COF-101,
FR-ID-001-004, T-ID-01-04/08, G0). The backend
uses `near-api-js` 7.4.0 and the final NEP-413 format. Five-minute challenges
bind the exact recipient origin, testnet network, message, expiry, 32-byte nonce,
and browser state. Only nonce/state hashes are stored. The RPC verifier requires
the submitted public key to be a current full-access key and verifies the exact
signed payload. One serializable PostgreSQL transaction consumes the challenge,
links the wallet identity, and creates an eight-hour session from hashed session
and CSRF tokens. Session cookies are HTTP-only and SameSite strict; HTTPS origins
enable `Secure`; every authenticated mutation requires the matching readable
CSRF cookie/header and server-side session hash; logout revokes server-side
state. Active-session reads filter revoked memberships on every request.

Tests cover replay, expiry, wrong state/network/signer, malformed encoding,
atomic challenge consumption, immediate membership revocation, double-submit
CSRF, logout invalidation, safe cookies, active-session lookup, organization
ownership, duplicate slugs, account/network-targeted one-time invites, owner-only
membership administration, role denial, and 401/403/404 tenant boundaries. Only
invite-token hashes are stored. Organization mutations recheck owner authority
inside the database operation, and invite acceptance uses a serializable
transaction. The RPC signature path is adapter-tested with a mock verifier; no
live wallet or public RPC authentication was performed. T-ID-05 is proven for
the current organization-scoped settlement surface; its invoice/payroll/audit
variants are deferred to B-06/B-09/B-10. Employee self-only T-ID-06 and the
separate auditor export permission T-ID-07 cannot be completed before those
resource modules exist and remain explicit exit tests for those tickets.

B-03 is complete locally (COF-102/103, FR-TRE-001-003, T-LED-01-07, G1
transaction-kernel foundation). JSON atomic amounts are canonical positive
integer strings and become `bigint` inside the domain; display conversion,
mixed 6/24-decimal assets, basis-point fees, and split rounding use integer
arithmetic only. The typed registry distinguishes `mock:base:usdc`,
`mock:near:usdc`, `near:testnet:native`, exact-contract testnet `ctUSD`, and
provider-discovered Intents identities. Symbols never identify an asset.

The PostgreSQL ledger stores normalized per-asset account balances, immutable
journal headers/lines, linked reversals, and balance reservations. Compound
foreign keys bind every line and reservation to the same organization, asset,
and account. Deferred database triggers reject zero-line, one-line, and
unbalanced journals at commit, while append-only triggers reject updates and
deletes. Serializable transactions lock account rows in stable order, retry
PostgreSQL serialization failures, prevent spending reserved balances, and bind
organization-scoped idempotency references to request digests.

Historical B-03 completion evidence: 103 unit tests passed with 92.18% statements, 85.35%
branches, 90.44% functions, and 92.26% lines; 13 PostgreSQL/Redis integration
tests and seven HTTP E2E tests pass. T-LED-03 runs competing 700-unit
reservations against a 1,000-unit balance and permits only one. T-LED-04 keeps
the original journal unchanged and creates one linked reversal. T-LED-06 assigns
the integer remainder to the declared recipient, and T-LED-07 returns the prior
journal for the same reference/digest while rejecting changed payloads. No
treasury HTTP mutation or transfer/signing path exists yet.

B-04 is complete locally (COF-301/302/303, ADR-002/004/005 and ADR-0005,
FR-POL-001-003, FR-APR-001-002, T-POL-01-06, T-CON-10, G3 authorization
foundation). Policies are normalized, deterministically hashed, versioned, and
evaluated with exact integer atomic amounts, stable reason codes, expiry,
freeze, asset/chain/recipient allowlists, rolling limits, and optional agent and
vendor caps. Missing, malformed, stale, or unavailable policy state denies.

Financial proposal material and approval facts are append-only. A material edit
creates a new revision and digest without inheriting approvals. Distinct active
human members count once even when they control multiple verified wallets.
Execution rechecks policy, proposal expiry, digest, exact approval hashes, and
current membership/wallet eligibility, so membership revocation immediately
removes that signer from quorum.

Organization row locking, current-policy checks, rolling-cap rechecks, and four
bounded serialization retries run inside proposal creation/revision
transactions. A forced two-request race proves two 1,400-unit proposals cannot
both enter a 2,500-unit rolling window. Returning to an earlier policy body now
creates a new immutable version with the same content digest rather than
colliding with historical policy.

The backend `coffer:proposal:v1` encoder matches the contract golden vector.
The NEAR adapter builds unsigned create/approve calls and verifies configuration,
proposal, and contract code against one final block. It validates canonical
base64 schemas, network, code hash, organization/policy/proposal commitments,
revision, threshold, state, expiry, and exact eligible approver accounts. RPC,
schema, block, code, state, or commitment mismatch fails closed. No wallet was
asked to sign, no RPC write occurred, and no contract was deployed.

Fresh B-04 evidence on 2026-10-30: all 191 current unit tests pass, with the
policy module at 85.90% statements, 80.44% branches, 90.62% functions, and
87.18% lines. All 37 current PostgreSQL/Redis integration tests and 11 HTTP E2E
tests pass. Typecheck, format, type-aware lint, production build, generated
OpenAPI freshness, contract TypeScript digest parity, the 22 Rust unit tests,
the NEAR Sandbox quorum test, credential marker scan, and dependency audit pass.
All 11 migrations also apply cleanly to a newly created empty PostgreSQL
database as well as the existing local database.
The repository-wide branch result is 75.78% after later automation and worker
modules were added; that separate B-11 coverage gate remains open and its
threshold was not reduced.
B-01, B-02, and B-03 are therefore reconfirmed complete for their stated local
scope. Full G0 remains open for frontend Playwright and the resource-specific
T-ID-05/06/07 variants assigned to B-06, B-09, and B-10.

B-05 and the local backend Gate G1 are complete (COF-104/202, ADR-004 and
ADR-0006, FR-PAY-001/002/004-007, T-PAY-02 and T-PAY-04-12).
PostgreSQL is authoritative for quotes, attempts, tenant-scoped idempotency,
immutable observations and status history, refunds, reconciliation cases,
one-time posting intents, and recoverable outbox leases. Redis carries poll and
reconciliation jobs only. Verified terminal evidence must match the stored
amount, canonical asset, and recipient before an idempotent B-03 ledger journal
can be posted. Unknown, underfunded, expired, inconsistent, and unsupported
confidentiality paths fail closed without another payment attempt.

The database integration suite sends 100 concurrent copies of one terminal
provider event and observes one settlement observation, posting intent, and
ledger journal. Restarted service instances replay the original idempotent
response; changed payloads conflict. Refund delivery, false success,
reconciliation queueing, worker replay, and real local Redis delivery are also
covered. This evidence is mock-only and performs no wallet signing, provider
call, testnet transaction, deployment, or live transfer.

Fresh B-01-through-B-05 evidence on 2026-10-30: 131 unit tests pass with 85.05%
statements, 81.13% branches, 82.23% functions, and 85.97% lines; 25 real
PostgreSQL/Redis integration tests and seven HTTP E2E tests pass. The B-05
migration applied successfully to local PostgreSQL. Prisma validation,
typecheck, formatting, type-aware lint, production build, generated OpenAPI
freshness, credential marker scan, and dependency audit pass. The separate
worker startup smoke reached its run loop before manual shutdown.

B-06 is complete locally (COF-201, ADR-0007, FR-INV-001-003, T-ID-05 invoice
variant, and the J-01 API path). Draft invoices derive exact totals from bounded
atomic line amounts and are editable only before issue. Issue freezes material;
due invoices may expire and draft or issued invoices may be voided. A 256-bit
public token is returned once and only its digest is stored. Public responses
omit customer contact data, metadata, tenant/user identifiers, payment IDs, and
token material.

Invoice-linked quotes bind the canonical destination asset, exact payee, and a
positive amount no greater than outstanding value. Initiation rechecks the
binding. The verified settlement transaction updates received value and marks
the invoice paid only at or above the exact total. Multiple attempts expose
unpaid, partial, paid, and overpaid accounting states. Unknown, underfunded, and
refunded mock attempts remain unpaid. PostgreSQL integration covers draft
immutability, token redaction, tenant isolation, mismatched quotes, partial and
complete payment, concurrent overpayment, negative settlement states, void,
and expiry. HTTP E2E covers create -> issue -> redacted public read -> quote ->
idempotent attempt -> verified settlement -> paid read.

Fresh B-06 evidence on 2026-10-30: 144 unit tests pass with 85.57% statements,
81.01% branches, 83.39% functions, and 86.51% lines; 33 real PostgreSQL/Redis
integration tests and nine HTTP E2E tests pass. All nine migrations are applied
to local PostgreSQL. Prisma validation, strict typecheck, formatting, type-aware
lint, production build, generated OpenAPI freshness, credential marker scan,
and production dependency audit pass. This evidence remains mock-only and does
not sign with a wallet, call a settlement provider, deploy, or transfer funds.

B-07 is complete locally (COF-203, COF-204, ADR-0008, FR-PAY-003/007, and
the provider portions of T-PAY-01/07/10/11/12). The direct NEAR testnet adapter
creates exact native NEAR or registered `ctUSD` wallet instructions without
loading a signing key. Verification independently requires the testnet chain,
final execution, successful receipts, exact hash/signer/receiver/action/amount,
and a durable tenant-bound hash claim. `ctUSD` additionally pins the deployed
code hash, metadata, test-only configuration, receiver storage registration,
one-yocto `ft_transfer` arguments, and the matching NEP-297 event.

The NEAR Intents adapter uses current `/v0/tokens` discovery, provider-returned
asset IDs, atomic integer amounts, bounded exact-input requests, runtime schema
validation, response-size and timeout limits, and official SDK 0.1.26 signature
verification. It covers all seven documented 1Click statuses. Discovery and dry
quotes have an independent read-only flag; wet quotes and deposit evidence need
both provider and global live flags; confidentiality needs its own flag. All
flags default off, while mock remains the settlement default.

Fresh B-07 evidence on 2026-10-30: 175 unit tests pass with 85.32% statements,
80.64% branches, 84.89% functions, and 86.49% lines; 34 real PostgreSQL/Redis
integration tests and nine HTTP E2E tests pass. The integration suite proves
that concurrent tenants cannot claim the same provider/network transaction
hash. All ten migrations are applied to local PostgreSQL. Prisma validation,
strict workspace typecheck, formatting, type-aware lint, production frontend
and backend builds, generated OpenAPI freshness, credential marker scan, and
production dependency audit pass. Sanitized provider/RPC fixtures were used;
no wallet signature, external RPC or 1Click request, deployment, testnet
transaction, mainnet deposit, or fund transfer occurred.

B-08 is complete locally (COF-401/402/403, ADR-0009, FR-AI-001-004,
FR-AGT-001-004, T-AI-01-05, and T-AGT-01-06). CFO inference receives only
tenant-scoped structured invoice metadata. Its strict output schema rejects
tool, transfer, destination, account, category, evidence, and amount changes.
Only an authorized human approval creates an idempotent ledger reservation.
Provider, model, prompt-template version, input/response digests, validation
state, and attestation state are retained without plaintext prompts.

The agent registry fixes action, asset, chain, per-purchase cap, rolling budget,
rolling-window duration, vendor allowlist, and expiry at creation. PostgreSQL
prevents later edits to those authority fields. Offers come only from the
seeded in-process registry, contain no caller-selected URL, and are stored as
append-only controlled terms with a SHA-256 digest. Serializable purchase
claims lock the agent, reject duplicates and current-window oversubscription,
and bind the exact offer to the existing central policy and human approval
flow. Execution rechecks agent status, offer digest and bounds, and central
policy before mock fulfillment. The feature remains disabled by default.

Fresh B-08 evidence on 2026-10-30: 220 unit tests pass and the repository
coverage gate passes at 86.04% statements, 80.40% branches, 87.91% functions,
and 87.30% lines; the automation slice has 85.91% branch coverage. All 39
PostgreSQL/Redis integration tests and 11 HTTP E2E tests pass. The 13-migration
chain applies both to the existing local database and a newly created empty
database. Strict typecheck, formatting, type-aware lint, production backend
build, generated OpenAPI freshness, and the credential marker scan pass.
The production dependency audit reports no known vulnerabilities.

No real NEAR AI request, external vendor call, wallet signature, deployment,
testnet transaction, mainnet deposit, or fund transfer occurred. NEAR AI
responses remain explicitly `UNVERIFIED` until B-09 implements and enforces
preflight model-attestation and exact-byte response-signature verification.
B-09 is complete locally (COF-501/502, ADR-0010, FR-PRV-001-005,
T-PRV-01-10, the payroll T-ID-05/06 variants, and T-ID-07's separate auditor
permission). A fixed-schema synthetic CSV import rejects extra columns,
malicious/formula fields, invalid atomic amounts, duplicate employee/user rows,
inactive employee memberships, immutable mapping changes, and explicit
per-employee or batch-cap violations.

Each batch uses a random data key. AES-256-GCM encrypts gross, net, legal name,
address, and payout account with field-specific authenticated context; the data
key is wrapped by the configured versioned local key. Only pseudonymous
employee codes, keyed commitments, aggregate totals, and a versioned manifest
remain outside individual ciphertext. Gross equals net under an explicit
synthetic no-tax assumption. Approval binds the exact manifest digest and
version, while PostgreSQL prevents edits to batch material, encrypted lines,
and analysis evidence.

Finance plaintext reads, self payslip reads, denied cross-user attempts, and
purpose-limited redacted auditor views are audited. The self endpoint binds the
authenticated user to an active employee membership and returns not found for
another employee or tenant. No payout route, signing authority, on-chain salary
event, or public payroll response was added.

Private analysis performs model-attestation preflight before constructing an
external completion, preserves exact request/response bytes, and requires an
Ed25519 `provider_tee` signature matching exactly one retained verified report.
Schema validation restricts findings to known line IDs and bounded anomaly
fields. The default DCAP/model-report verifier is deliberately unavailable, so
no salary leaves the process and deterministic local analysis is clearly
labeled `NOT_REQUESTED`. This is an honest fallback, not a verified TEE claim.

Fresh B-09 evidence on 2026-10-30: 264 unit tests pass with 86.58% statements,
80.64% branches, 88.76% functions, and 87.92% lines; the payroll slice has
81.22% branch coverage. All 42 PostgreSQL/Redis integration tests and 12 HTTP
E2E tests pass. All 14 migrations apply to the upgraded local database and a
new empty database. Prisma validation, strict typecheck, formatting, type-aware
lint, production backend build, generated OpenAPI freshness, credential scan,
and production dependency audit pass.

No live NEAR AI call, model report, wallet signature, deployment, testnet
transaction, mainnet deposit, or fund transfer occurred. B-10 evidence follows.

B-10 is complete locally (FR-AUD-001-003, ADR-0011, Gates G2/G4, and the
audit/operator portions of J-01 through J-05 and T-ID-05/07). PostgreSQL assigns
every audit event a tenant-local sequence, previous hash and SHA-256 event hash
under an organization advisory lock. The hash binds the event fields and
metadata. Updates and deletes fail unless a transaction-local test cleanup
bypass is explicitly enabled. Controlled triggers cover permission changes,
financial and agent proposals, approvals, policy decisions and denials, CFO
decisions, payment attempts and transitions, and reconciliation cases. Payroll
reads, denials, approvals and attestation outcomes retain their explicit events.

The redacted audit API verifies the complete tenant chain and supports bounded
cursor pagination. The operator API classifies queued, pending, stale/stuck,
refunded and completed settlement work and exposes aggregate counts without
recipient, amount, provider payload or payroll data. Finance/owners may queue
an idempotent recheck of an existing uncertain payment. The action creates no
quote, payment attempt, deposit, ledger posting or status override; auditors
remain read-only.

The idempotent synthetic seed creates role fixtures, one issued invoice and one
uncertain mock settlement without credentials or payroll PII. The reset command
parses the URL, permits only local non-system PostgreSQL databases, refuses
production, requires explicit confirmation, reapplies migrations and reseeds.
All 16 migrations and the seed apply twice successfully to a new empty database.

Fresh B-10 evidence on 2026-10-30: 275 unit tests pass with 86.74% statements,
80.67% branches, 89.02% functions and 88.06% lines; the operations controller
has 80% branch coverage and its PostgreSQL adapter is covered by integration.
All 45 PostgreSQL/Redis integration tests and 13 HTTP E2E tests pass. The
16-migration chain is current on the upgraded database and applies cleanly to a
new empty database. The synthetic seed succeeds idempotently on both databases.
The guarded reset command also rebuilds and seeds a separate disposable local
database end to end while its negative tests reject remote, system and
production targets.

Formatting, strict typecheck, type-aware lint, production build, Prisma
validation, generated OpenAPI freshness, credential scanning and the production
dependency audit pass.

No provider request, wallet signature, deployment, blockchain transaction or
fund transfer occurred. Database-local hashes are not external notarization;
external immutable audit archives, alerts, retention, backup drills and
incident automation remain later production work.

B-11 is complete for the local automated hardening scope (COF-602 and backend
gate B0). CI now runs the targeted settlement security regression explicitly,
in addition to the complete coverage suite. The critical-test manifest finds
all 54 required T-ID, T-LED, T-POL, T-AI, T-PAY, T-PRV and T-AGT identifiers
across 53 test files. The mock settlement security suite passes all 20 tests.
Concurrency evidence remains part of the database integration suite: 100
repeated terminal events produce one posting, reservations and agent budgets
serialize, duplicate provider evidence is rejected, and append-only audit
sequencing remains tenant-local.

Fresh B-11 evidence on 2026-10-31 under Node.js 24.15.0: 275 unit tests in 36
files pass with 86.74% statements, 80.67% branches, 89.02% functions and
88.06% lines. The designated critical modules pass 261 of 284 branches
(91.90%), above the 90% gate. All 45 PostgreSQL/Redis integration tests and 13
HTTP E2E tests pass against a disposable database created from the complete
16-migration chain. Frozen lockfile installs pass independently for frontend
and backend. Prisma validation and generation, formatting, strict typecheck,
type-aware lint, frontend/backend production builds, generated OpenAPI
freshness, credential scanning, and frontend/backend production dependency
audits pass. The local API performance smoke completes 250 requests at 25-way
concurrency at 7,323.3 requests/second with a 5.0 ms p95; it is a loopback
liveness smoke and is not a production capacity claim.

COF-602 is not closed as an external release gate. An independent human
security review has not occurred, CI has not run on a hosted runner in this
workspace, and browser Playwright coverage belongs to the unfinished frontend
phase. The type-aware linter exits successfully but reports test-only warnings
for unbound mock methods, object stringification, and one class-instance
spread. Live provider requests, wallet signatures, deployments, blockchain
transactions, fund transfers, penetration testing, backup/recovery drills,
alerts and measured production SLOs were not performed. These items must not
be described as implemented or tested.

The subsequent website design checkpoint implements the visual portions of
F-01 through F-07 described in section 6. Fresh frontend evidence on 2026-10-31:
14 Playwright tests pass in 14.5 seconds across desktop and emulated mobile
Chromium, and both exact-money unit tests pass. Formatting, ESLint, strict
typecheck and the production Next.js build pass; the build generates 14 static
pages including framework and legacy routes. The credential marker scan passes
for 239 source files. The frontend production dependency audit reports no
known vulnerabilities. Twenty-two desktop/mobile screenshots are retained in
`docs/design/screenshots`. Browser testing found and fixed invoice-table
overflow on mobile and modal focus restoration after dismissal.

Frontend files changed include the app layouts/routes/styles, `components/coffer`,
`lib/demo.ts`, tests, Playwright configuration, screenshot capture script,
package/lockfile and README. CI and ignore rules now include browser testing;
ADR-0012 documents the demo boundary. No backend, contract or OpenAPI behavior
changed. Backend/contract suites were not rerun for this frontend-only slice;
their earlier results above are historical evidence. Hosted CI, Safari/Firefox,
screen-reader review and complete authenticated product journeys were not run.
The test runner emits harmless module-type/color-environment warnings.

### F-01 integration checkpoint — 2026-11-01

F-01 is implemented locally for COF-601, FR-ID-001–004 and Gate G0, with one
manual evidence gap. The frontend generates request/response types from the
version-controlled OpenAPI, validates consumed payloads with strict Zod
schemas, and reaches the backend through a same-origin Next.js proxy. NEAR
Connect requests an atomic `signInAndSignMessage` proof for the API-issued
NEP-413 challenge. The backend remains the authority for signature/key checks,
session cookies, CSRF, membership, revocation and tenant permissions.

Canonical workspace routes now cover loading, anonymous, API-unavailable,
first-organization, authenticated and forbidden states. Navigation reflects
the current server-returned role; this is UX only and never replaces API
authorization. Logout revokes the server session and disconnects the local
wallet. The public visual workspace moved to `/demo/*` and remains clearly
labelled as synthetic with no fund movement.

Optional Privy social login is integrated through the official NEAR Connect
plugin. It creates a Privy extended-chain NEAR wallet, then requires that wallet
to sign the same backend-verifiable NEP-413 challenge as every other wallet.
Only public Privy App/Client IDs reach the browser; the pinned wallet executor,
same-origin signing page and disabled debug logging are recorded in ADR-0013.

Local evidence: generated OpenAPI/types, format, ESLint, strict typecheck, two
exact-money unit tests, production build with 24 generated pages, and 24
Playwright cases across desktop/mobile Chromium pass. Browser cases cover
logged-out, API unavailable, restored membership, role denial, expired/revoked
revalidation, CSRF-protected organization creation, CSRF-protected logout and
the existing demo journeys. The production dependency audit has no high or
moderate findings after exact transitive security overrides; one low finding
remains: the NEAR JavaScript crypto dependency reaches `elliptic` 6.6.1 through
`secp256k1`, and the advisory currently lists no patched `elliptic` version.
Coffer's testnet login requests Ed25519 NEP-413 proofs and holds no browser
private key, but this transitive issue must be rechecked when NEAR packages
change. No Privy credentials or interactive testnet wallet were available, so a
real external-wallet/Privy popup signature and browser-to-RPC proof is **not
tested**. F-01 must not be called release-verified until that manual test is
retained. Full accessibility review, hosted CI, Safari and Firefox also remain
open under F-07/G5.

### F-02 invoice and mock-settlement checkpoint — 2026-11-01

F-02 is complete locally for the approved mock scope (J-01, FR-INV-001–003,
FR-PAY-001/002/004–007, COF-201/202 and Gate G2 evidence). The canonical
`/invoices` route now lists tenant-scoped backend invoices, creates and edits
exact-integer Mock USDC drafts, issues or voids them according to server state,
and shows verified received/outstanding amounts plus payment attempts. Role UI
permits mutations only for owners and finance administrators; backend
authorization remains independently enforced. `/demo/invoices` is unchanged
and remains synthetic.

The public `/pay/{token}` journey uses the stored 256-bit bearer token without a
workspace session. New token-scoped endpoints derive invoice ID, organization,
destination asset, amount and recipient from the server invoice; payer input is
limited to the mock source, refund destination, slippage and explicitly labeled
demo outcome. Quote and payment responses remove organization/invoice IDs and
the internal request digest. Initiation requires idempotency and verifies the
quote is bound to the token invoice before creating an attempt. Reads and mock
polls reject attempts from any other invoice. The payer reviews source,
expected amount, fee, slippage, recipient, refund destination, privacy mode and
expiry before recording mock authorization. The UI never calls a wallet or
claims that this simulation is a signature or transfer.

Invoice state is refreshed only after terminal reconciliation. `SETTLED`
evidence can produce `PAID`; unknown, refunded and underfunded outcomes remain
visibly unpaid. Exact decimal parsing uses strings and `BigInt`, never JavaScript
floating point. Generated OpenAPI response schemas and strict runtime Zod
validation cover authenticated and public invoice/settlement responses.

Fresh local evidence: backend formatting, strict typecheck, build, generated
OpenAPI freshness, 277 unit tests and all 13 PostgreSQL/Redis HTTP E2E tests
pass. The J-01 HTTP test now runs the public bearer-link quote/payment/poll path
and verifies redaction before the database invoice becomes paid. Frontend
formatting, ESLint, strict typecheck, four exact-money unit tests and production
build pass. All 34 Playwright cases pass across desktop and emulated mobile
Chromium; F-02 cases cover create/issue, success only after three reconciliation
observations, unknown, refunded and underfunded terminal states. The local Node
22.20.0 runtime is below the frontend's declared 22.22.2 minimum, although every
listed check passed; release evidence must use the declared Node version.

Unimplemented or unverified: a public token is intentionally returned only at
creation and stored only as a digest by the backend, so this frontend retains it
in session storage for immediate sharing and cannot recover or rotate an older
link. Real NEAR wallet authorization, native testnet/`ctUSD` transaction
submission, 1Click execution, notification delivery and automatic expiry are
outside this mock ticket and remain disabled. Public rate limiting, Safari,
Firefox, screen-reader/contrast review, hosted CI and an independent security
review are also open. No wallet signature, provider request, deployment,
blockchain transaction or fund transfer occurred.

### F-03 treasury and policy approval checkpoint — 2026-11-01

F-03 is implemented locally for J-02/J-04, FR-POL-001–003,
FR-APR-001/002, FR-TRE-001–003, COF-301–303 and the local portion of Gate G4.
The canonical `/treasury` route reads tenant-scoped Mock USDC ledger accounts
and labels every balance `ledger-derived internal`; custody is explicitly `not
on-chain verified`. An empty ledger stays empty rather than fabricating the
illustrative revenue balance. Owners can activate a fixed versioned policy with
transaction/rolling caps, two distinct eligible approvers, expiry and the one
allowed revenue-split commitment.

Proposal creation accepts only the source account, exact atomic amount and
expiry from the browser. The backend derives the 50/30/20 payroll, operations
and partner-distribution split, assigns any atomic-unit remainder to payroll,
constructs nonce/idempotency/recipient commitments, evaluates current policy
and creates the canonical digest. Editing creates a new immutable revision and
cannot carry approvals forward. Pending revisions can be rejected. Expired,
stale, cancelled and superseded revisions cannot be approved or reserved.

Approval is tied to a distinct user and a NEAR account already verified by that
session's NEP-413 login. It is an off-chain approval record and **not** a fresh
wallet signature or contract transaction; the UI says this directly. After
quorum, `verify and reserve` rechecks current policy, digest, expiry, authorized
memberships and any configured final NEAR contract binding before creating an
idempotent internal ledger reservation. RPC/contract verification failure
produces no reservation. No automatic settlement or transfer was added.

Fresh evidence: backend formatting, strict typecheck, lint (with the existing
test-only warnings), production build, OpenAPI freshness and all 284 unit tests
pass. Frontend formatting, ESLint, strict typecheck, four exact-money unit tests
and production build pass. All 46 Playwright cases pass across desktop and
emulated mobile Chromium; 12 are F-03 cases covering truthful balance labels,
server-only authorization inputs, exact atomic values, duplicate approver UX,
quorum, revision invalidation, expiry, policy denial and fail-closed RPC
verification. ADR-0014 records the boundary.

Still unimplemented or unverified: the policy contract and test token remain
undeployed, no organization has a retained contract-binding browser proof, no
fresh wallet signature is requested for each approval, and no real custody
balance or transfer is shown. The new wrapper routes were not exercised through
a live PostgreSQL-backed HTTP integration test in this slice; their domain,
repository primitives and mocked browser contracts are automated separately.
No live wallet, provider request, deployment, blockchain transaction or fund
movement occurred. Safari, Firefox, screen-reader/contrast review, hosted CI and
independent security review remain open under F-07/G5.

### F-04 evidence-bound automation checkpoint — 2026-11-01

F-04 is implemented locally for J-03, FR-AI-001–004, FR-AGT-001–004 and
COF-401–403. Canonical `/cfo` now selects issued invoice evidence, a
tenant-scoped ledger source and an exact integer maximum. The backend supplies
only scoped structured metadata to the configured adapter and retains provider,
model, prompt version, validation and attestation state. Allocation category,
amount and evidence references are schema- and bounds-checked. The screen marks
reasons and uncertainty as untrusted, labels NEAR AI attestation verification
`not implemented`, and never treats `UNVERIFIED` as private or trusted. Human
approval creates only an idempotent internal ledger reservation.

Canonical `/agents` now exposes the immutable action, mock asset/chain,
per-purchase cap, rolling budget, vendor allowlist and expiry enforced by the
backend. Owner-only policy activation merges those exact bounds and the seeded
recipient commitment into a new central-policy version. Offers display only
normalized controlled terms, exact price, digest, expiry and recipient
commitment; arbitrary vendor text and URLs never become authorization inputs.
Purchase creation binds the exact offer to the central policy. A verified
session identity can approve the exact instruction once, the existing
distinct-person quorum applies, and execution revalidates policy and offer
bounds before deterministic mock fulfillment.

`FEATURE_AGENT_EXECUTION=false` remains the default. With the gate off, typed
offers remain inspectable while purchase creation and execution fail closed.
Settlement remains mock and the UI says no external transfer occurred. New
tenant workspace reads are bounded to the newest 100 CFO proposals, offers and
purchases. OpenAPI and the strict runtime client cover the new workspace,
policy and purchase-approval routes. ADR-0015 records this boundary.

Fresh local evidence: backend formatting, type-aware lint, strict typecheck,
OpenAPI freshness and production build pass. All 288 backend unit tests, 45
PostgreSQL/Redis integration tests and 13 HTTP E2E tests pass; the automation
HTTP journey now exercises both workspace reads, the purchase approval wrapper
and owner policy activation. Frontend formatting, ESLint, strict typecheck,
four exact-money unit tests and production build pass. All 54 Playwright cases
pass across desktop and emulated mobile Chromium; eight F-04 cases cover
attestation labels, adversarial model prose, exact integer CFO input, the
disabled execution gate, typed offer authority, policy binding, quorum and mock
fulfillment.

Still unimplemented or unverified: no live NEAR AI request, model-attestation,
NVIDIA NRAS/Intel TDX verification or exact response-signature verification was
performed. No fresh wallet signature is requested for CFO or purchase approval,
no NEAR contract is deployed or checked by these screens, and no external
vendor, real deliverable, wallet transaction, token movement or payment exists.
The canonical CFO form selects one invoice per run even though the API supports
multiple evidence records, and the bounded workspace reads have no pagination
UI. Safari, Firefox, screen-reader/contrast review, hosted CI and independent
security review remain open. The local frontend checks ran on Node 22.21.1,
below the declared 22.22.2 minimum, and must be repeated on the pinned Node 24
release for release evidence.

### F-05 encrypted synthetic payroll checkpoint — 2026-11-02

F-05 is implemented locally for J-05, FR-PRV-001–005, COF-501/502,
T-PRV-01–10 and the payroll portions of T-ID-05/06. Canonical `/payroll`
replaces the browser-only demo for authenticated users. Owners and finance
administrators can list bounded tenant batch summaries, import only strict
synthetic CSV, read an authorized decrypted batch, run deterministic rules,
attempt the strictly gated private-analysis path, and approve the exact current
manifest digest/version. The browser sends exact atomic strings and never puts
salary values, employee identifiers or payroll content in a URL.

Employees use only `GET /v1/me/payslips`. The new bounded collection query
requires an active employee membership and filters by the authenticated user
before decryption. It never calls the organization finance endpoint. Each
returned payslip records a sensitive self-read audit event. Finance batch lists
contain summaries only; legal name, address, payout account and individual
amounts appear only in the already permission-gated detail response.

Private analysis remains fail-closed. Deterministic results display
`NOT_REQUESTED` and explicitly make no private/TEE claim. With the default
`FEATURE_PRIVATE_AI=false`, the private option displays unavailable and accepts
no result. No NEAR AI request or payroll payload left the application. This
matches the current NEAR off-chain-compute model: a privacy claim requires TEE
attestation and signed result evidence, not merely a provider response
([NEAR AI and Cloud Services](https://docs.near.org/getting-started/hackathons#ai-and-cloud-services),
[Off-chain Compute](https://docs.near.org/primitives/off-chain-compute/what-is)).

Fresh evidence: backend formatting, type-aware lint (existing test-only
warnings), strict typecheck, production build, OpenAPI freshness and 289 unit
tests pass. The focused PostgreSQL payroll integration suite passes 3/3 and the
payroll HTTP e2e passes 1/1, including tenant denial, self-only reads,
private-AI disabled behavior, deterministic evidence and immutable approval.
Frontend formatting, ESLint, strict typecheck, four exact-money unit tests and
the Node 24 production build pass. The focused F-05/F-06 browser file passes
8/8 across desktop and emulated mobile Chromium; the full frontend regression
passes 62/62.

Still unimplemented or unverified: no live NEAR AI call, fresh attestation
nonce, NVIDIA NRAS verification, Intel TDX binding, model measurement check or
exact response-signature verification occurred. The finance import requires
the operator to supply active employee UUIDs; there is no employee picker or
CSV preview. The existing purpose-limited auditor batch view remains API-only
and no downloadable controlled audit export was added. Native testnet NEAR is
selectable only as a canonical batch denomination; this ticket does not submit
a payout. Real payroll data is prohibited, application encryption does not
make a public-chain payout confidential, and no wallet, deployment, provider
transaction, email or fund movement occurred.

### F-06 operations and audit checkpoint — 2026-11-02

F-06 is implemented locally for FR-AUD-003, the operator surface of B-10 and
the local J-01–J-05 observability portion of Gate G4. Canonical `/activity`
reads the tenant-scoped settlement dashboard, aggregate metrics and redacted
hash-chained audit API. It shows durable queued effects, pending attempts,
unknown/open/stale reconciliation work, refunded attempts and verified settled
attempts without showing recipient, amount, payroll content or provider
payload. Exact event-type filtering and bounded cursor pagination are supported.

Owners and finance administrators may queue an idempotent recheck only for an
existing open uncertain case. The backend continues to require CSRF,
organization permission and a unique idempotency key; it queues observation
through the outbox and does not alter the payment status or post a ledger
entry. Auditors can inspect integrity and redacted events but receive no
reconcile control. The UI keeps `UNKNOWN_REQUIRES_RECONCILIATION` visible after
the action and explains that queued does not mean settled.

Evidence is shared with the F-05 run above. In addition, the focused operations
HTTP e2e passes 1/1 for redacted reads, tenant denial, auditor denial and
finance-only idempotent recheck. Browser cases cover pending, unknown/stuck,
refunded and settled rendering, verified audit integrity, idempotency headers,
no request body, unchanged unknown status and auditor denial on desktop/mobile.
The combined parallel payroll+operations e2e invocation had one transient
database-connect failure while the container remained healthy; each suite
passes when run independently, so no combined-run success is claimed.

Still unimplemented or unverified: recheck evidence uses the mock adapter; no
live provider/RPC observation, automated case resolution, broad text search,
audit export, alert delivery or operator preference persistence was added.
Hash-chain verification is server evidence from local PostgreSQL, not an
external notarization. Safari, Firefox, screen-reader/contrast review, hosted
CI and independent security review remain open.

### F-07 accessibility, resilience and demo-evidence checkpoint — 2026-11-02

F-07 is complete for the code-owned local scope of COF-601, the frontend
regression portion of COF-602, and the seed/docs/screenshots/checklist portion
of COF-603. It does **not** close the independent-review portion of COF-602 or
the owner-controlled/public portions of Gate G5.

All public/demo routes now use a shared foreground token with automated
contrast coverage. Landing and workspace main regions accept skip-link focus;
the search/profile controls include their visible text in their accessible
names; mobile cash-flow targets satisfy the automated WCAG 2.2 target-size
check; and all routes reflow without horizontal overflow at 320 px. The demo
profile control now opens settings rather than presenting an inert logout
action. The authenticated fallback identifies API unavailability and gives a
specific retry path.

The screenshot capture script now visits `/demo/*`, not authenticated routes,
and separately captures the real API-unavailable sign-in boundary. Twenty-two
desktop/mobile PNGs were regenerated and visually inspected. The numbered
audit is in `docs/design/f07-audit.md`; `docs/demo-script.md` contains the
architecture diagram, J-01–J-05 narrative, safe seed/reset procedure and
evidence/limitation table; `docs/submission-checklist.md` keeps human-only G5
actions visibly unchecked.

Fresh Node 24 frontend evidence: format, ESLint, strict typecheck, four exact-
money unit tests and the 24-page Next production build pass. The final Chromium
regression passes 67 tests with one intentional desktop skip for the mobile-
only 320 px case. This includes axe-core WCAG 2 A/AA, 2.1 A/AA and 2.2 AA scans
over the landing page and all nine demo workspace routes in desktop and mobile
projects, skip-link focus, responsive overflow, the canonical F-01–F-06 paths,
and the existing dialog/motion/error-state coverage. A four-worker diagnostic
run had one Playwright trace-file teardown `EINVAL` after 66 product tests had
passed; the configured two-worker suite was rerun with tracing disabled and
exited cleanly, so no product failure is being hidden.

The production dependency audit reports one unpatched low-severity `elliptic`
finding through the optional Privy/NEAR crypto path. The full audit also reports
three moderate `minimatch` findings in lint/OpenAPI development tooling; the
high-threshold audit exits successfully. A forced cross-major minimatch override
was not added because it could break those tools. No backend, contract or
OpenAPI code changed in F-07, so their suites were not rerun.

Still unimplemented or unverified: manual screen-reader testing, Safari and
Firefox, hosted CI, independent human security review, final clean-machine
install, public repository/license/provenance approval, video, X post and form
submission. Real wallet/Privy signatures, deployed contract/test-token browser
proof, verified NEAR AI inference, confidential payment, external vendor,
provider/RPC settlement and any live transaction or fund movement remain
absent. F0, G4 and G5 therefore remain release gates rather than completion
claims. The next smallest task is an authorized human accessibility/security
review followed by a clean final-revision install.
