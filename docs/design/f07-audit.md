# F-07 product-design and accessibility audit

- Date: 2026-11-02
- Scope: COF-601, the code-owned portion of COF-602/603, and Gates G4/G5
- Viewports inspected: 1440 x 1000, 390 x 844, plus automated 320 px reflow
- Evidence: `docs/design/screenshots` (22 current PNGs)

This audit covers the public landing page, the synthetic no-wallet demo, and the
API-unavailable sign-in boundary. It does not claim manual screen-reader
conformance, browser coverage beyond Chromium, or production readiness.

## Audited steps

| # | Step | Health | Evidence and result |
| -: | --- | --- | --- |
| 1 | Landing and entry choice | Pass | Desktop/mobile screenshots show distinct sign-in and no-wallet demo paths, readable hierarchy, and no clipped content. |
| 2 | Sign-in recovery | Pass | API-unavailable screenshots show a specific recovery action and explain that NEP-413 login does not move funds. |
| 3 | Overview and navigation | Pass | Demo mode, synthetic data, and no-funds-move labels remain visible; keyboard skip navigation moves focus to main content. |
| 4 | Treasury | Pass with limitation | Illustrative ledger, unverified testnet NEAR, and unavailable ctUSD states are visually distinct; no custody or deployment claim is made. |
| 5 | Invoices | Pass with limitation | Draft/list/empty/export interactions reflow on mobile; this screenshot is synthetic and not settlement evidence. |
| 6 | Human approvals | Pass with limitation | Cards state that agents only suggest and that reviews are demo records, not wallet signatures or payments. |
| 7 | AI CFO | Pass with limitation | The deterministic demo is labelled “No live AI” and “Suggests only”; verified NEAR AI remains absent. |
| 8 | Agent commerce | Pass with limitation | Mock service, explicit budgets, pause controls, and no-spending-authority states are visible. |
| 9 | Payroll | Pass with limitation | Only synthetic employees appear; masking is described as a display preference and private AI verification is unavailable. |
| 10 | Activity and audit explanation | Pass with limitation | The demo says the local feed is not immutable backend evidence; canonical operator evidence remains test-backed. |
| 11 | Settings, motion, and reset | Pass | Reduced-motion preference, local-only reset scope, and demo limitations are explained at the point of use. |
| 12 | Responsive and keyboard behavior | Pass (automated) | All ten public/demo routes have no detected WCAG A/AA axe violations in desktop/mobile Chromium and do not overflow at 320 px. Dialog focus containment, Escape dismissal, and focus return are covered separately. |

## Findings resolved

- The screenshot script was visiting authenticated routes and repeatedly
  capturing the sign-in error. It now captures `/demo/*` and retains the real
  API-unavailable state as separate evidence.
- Shared low-contrast metadata, table labels, status explanations, payroll
  disclosures, and timeline text now use accessible foreground tokens.
- The overview chart exposes adequately sized mobile targets; the compact
  mobile chart removes a nonessential y-axis to preserve space.
- Landing and workspace main regions are programmatically focusable, so skip
  links work with a keyboard.
- Search and profile controls now have accessible names that include their
  visible labels. The demo profile control opens settings instead of acting as
  an inert logout button.
- The sign-in failure message identifies the unavailable API and gives a
  concrete recovery action.

## Automated evidence

`frontend/tests/accessibility.spec.ts` runs axe-core rules tagged WCAG 2 A/AA,
2.1 A/AA, and 2.2 AA over the landing page and all nine demo workspace routes.
It also checks skip-link focus and 320 px horizontal reflow. Automated checks
cannot prove complete WCAG conformance; manual assistive-technology review is a
remaining release task.

The full 22-image set was visually inspected; after the final shared
search/profile adjustment, the desktop and mobile overview captures were
rechecked. No screenshot is presented as proof of a wallet signature, provider
call, blockchain finality, private inference, or fund movement.
