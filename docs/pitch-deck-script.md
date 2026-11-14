# Coffer pitch and demo runbook — 2 minutes 50 seconds

Use with [`coffer-pitch-deck.html`](coffer-pitch-deck.html). Open the file in a
browser, press `F` for fullscreen, use the arrow keys to change slides, and
press `N` to show or hide speaker notes. Browser print can export the deck as a
16:9 PDF.

This pitch covers COF-201–204, COF-301–303, COF-401–403 and COF-501–503;
FR-PAY, FR-AI, FR-POL, FR-APR, FR-AGT and FR-PRV; ADR-002, ADR-003, ADR-004,
ADR-005 and ADR-006; and the demonstrated portions of Gates G2–G4.

## Before presenting

- Open the deck on slide 1 and the authenticated Coffer Activity page in a
  second tab.
- Keep one settled synthetic testnet invoice and its Finance Agent run ready.
- Keep one approved **synthetic** payroll manifest ready, with its private
  analysis status and payout preparation visible.
- Keep the policy/quorum evidence and payment route ready in background tabs.
- Do not show `.env`, provider credentials, wallet keys or real payroll data.
- Preserve the private-AI fallback wording unless a fresh NEAR AI call has
  passed deployment allowlisting, TEE attestation and response verification.
- If the hosted API is unavailable, use the deck only and describe the retained
  evidence. Do not switch to the fictional `/demo/*` workspace as proof.

## Slide 1 — the hook (0:00–0:20)

> Businesses are becoming AI-native, but their money still lives across
> disconnected invoices, wallets, payroll tools and spreadsheets. Coffer is the
> autonomous finance layer: it lets AI coordinate the work without ever giving
> AI unrestricted custody.

Pause briefly after “autonomous finance layer.”

## Slide 2 — the problem and product (0:20–0:50)

> The problem is not another dashboard. Sales, treasury and payroll are one cash
> cycle, but today they live in separate tools. Payroll makes the gap obvious:
> salary records need scoped privacy, while every payout needs exact approval
> and independently verified settlement. Coffer gives the AI CFO context while
> deterministic policy and human approval keep authority outside the model.

The core contrast is: **model intelligence, deterministic authority**.

## Slide 3 — demonstrate the autonomous loop and payroll (0:50–1:40)

Switch to the authenticated Activity page and show one Finance Agent run. Then
open the prepared payroll manifest; do not type employee data during the pitch.

> A verified invoice payment automatically creates one durable Finance Agent
> run. Coffer gathers only authorized evidence, asks the AI CFO for a typed
> decision, evaluates budgets and policy, and can reserve an allowed internal
> allocation. For payroll, active employee records are encrypted and compiled
> into one exact manifest. Private AI may flag anomalies, but cannot alter pay,
> approve the batch or sign. Every payout stops at the wallet boundary, and
> Coffer updates the run and payslip only after independently verifying
> finality, signer, recipient, asset and amount.

Point to, in order:

1. settlement trigger and evidence ID;
2. inference status and typed decision;
3. policy result, version and instruction digest;
4. encrypted synthetic payroll batch and exact manifest digest;
5. private-analysis verification status;
6. wallet payout boundary and reconciliation state.

Close the segment with:

> Revenue starts the loop, but payroll never becomes an unrestricted AI action.
> The model cannot change policy, salary, approval or recipient. Unknown payout
> evidence stays unknown, and duplicate evidence cannot pay twice.

## Slide 4 — sell the NEAR integration (1:40–2:25)

Return to the deck.

> NEAR is not a logo in Coffer; it is the coordination layer. NEAR Intents gives
> us one route for current asset discovery, exact cross-chain quotes,
> wallet-funded deposits and settlement status—so invoice collection and
> payroll payouts do not require a bridge integration for every chain. NEAR AI
> Cloud gives the CFO a verifiable private path to review minimized payroll
> anomalies: data is processed in TEEs and accepted only when the deployment and
> response verify. NEAR contracts give each business its own policy instance,
> binding exact proposal and approval digests without publishing salaries or
> holding treasury funds.

Then state the evidence boundary clearly:

> Our testnet rehearsal uses direct NEAR settlement and a compatible sandbox
> adapter; the production cross-chain route is the NEAR Intents 1Click API. If
> private-AI attestation is unavailable, Coffer says so and stops that branch.

Optional five-second proof: show the two distinct testnet policy approvals.

## Slide 5 — proof and close (2:25–2:50)

> Coffer connects revenue to treasury decisions, payroll preparation and
> wallet-authorized settlement. We have durable finance-agent state, encrypted
> synthetic payroll, live testnet contract quorum and independently verified
> settlement architecture. The future is not an AI with a wallet. It is a
> business with safe autonomy. Coffer makes that possible on NEAR.

Stop. Do not dilute the close with a feature list.

## Fast fallback — 90 seconds

If the schedule is cut, use slides 1, 3, 4 and 5:

- 0:00–0:15 — hook;
- 0:15–0:45 — autonomous loop, without changing tabs;
- 0:45–1:15 — NEAR Intents, NEAR AI Cloud and contracts;
- 1:15–1:30 — evidence and close.

## Judge questions — concise answers

**What makes this autonomous?**

A verified settlement event creates and advances durable work without an
operator pressing “run.” Autonomy is bounded: models propose, deterministic
policy authorizes internal effects, wallets authorize external effects, and
reconciliation decides completion.

**Why NEAR Intents?**

It turns supported cross-chain swaps into one outcome-based integration:
discover assets, request an exact quote, fund the provided route with the
user's wallet and track the terminal result. Coffer adds policy, accounting and
reconciliation around that rail.

**Why NEAR AI instead of a normal model API?**

Financial data is sensitive. The intended production path requires TEE-backed
inference, deployment attestation and signed-response verification. Coffer
fails closed when those proofs are absent and never treats model output as
payment authority.

**How does payroll work?**

An owner invites employees into the tenant, finance enters synthetic payroll
records individually or by CSV, and Coffer encrypts sensitive fields. Exact
integer amounts become an immutable manifest. Deterministic rules always run;
verified NEAR AI may flag anomalies but cannot edit pay or approve execution.
Finance approves the manifest, the authorized wallet signs each payout, and
Coffer verifies every transaction before updating the run and employee's
self-only payslip.

**Why smart contracts if the ledger is off-chain?**

The contract is an independent policy commitment and quorum proof. It records
the exact proposal digest and distinct approvals; it does not store payroll
PII, hold treasury funds or replace the accounting ledger.

**Is this production-ready?**

It is a production-minded hackathon system with live testnet contract evidence
and extensive automated tests. Mainnet payments, verified live private
inference, independent security review, operational key management and
jurisdiction-specific payroll/compliance remain release gates.

## Official integration references

- [NEAR Intents overview](https://docs.near.org/chain-abstraction/intents/overview)
- [NEAR Intents 1Click documentation](https://docs.near-intents.org/integration/distribution-channels/1click-api)
- [NEAR AI Cloud](https://docs.near.ai/)
- [NEAR smart contracts](https://docs.near.org/smart-contracts/what-is)
- [NEAR wallet login](https://docs.near.org/web3-apps/tutorials/wallet-login)

The presentation's implementation evidence is recorded in
[`g4-evidence.md`](g4-evidence.md); the longer product recording sequence
remains in [`demo-script.md`](demo-script.md).
