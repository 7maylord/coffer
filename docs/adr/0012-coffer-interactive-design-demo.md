# ADR-0012: Coffer interactive frontend design demo

Date: 2026-10-31

Status: accepted for the visual demo; production integration remains open.

Related: ADR-002/004/006; COF-601; F-01–F-07; FR-ID, FR-INV, FR-TRE,
FR-APR, FR-AI, FR-AGT, FR-PRV-005 and FR-AUD; Gates G0/G2/G4/G5.

The requested design replaces the generated homepage with an editorial public
site and nine distinct workspace pages. Ivory, oxblood, warm neutrals, serif
accents, original CSS/SVG illustrations, and restrained movement form one visual
system. The treasury sculpture responds to the pointer; its nodes also support
click and keyboard interaction. Native scrolling and the normal cursor remain.

The existing Next.js frontend remains an independent package. No animation
runtime, remote font, image service, wallet initialization or API request is
needed for the demo. The original NEAR example is isolated at `/hello-near`.

Workspace state is synthetic and held in React memory. Navigation preserves it;
refresh resets it. Invoice drafts, CSV export, allocation previews, review
decisions, agent pause/resume, payslip previews, activity filters, command search
and settings are local interactions. Integer cents and BigInt preserve exact
demo amounts. These interactions do not imply backend authorization, reservations,
settlement, cryptographic evidence, payroll encryption or verified inference.

The UI labels the workspace as a demo. Payroll uses pseudonymous synthetic
records and explains that visual masking is not privacy. No real user or payroll
data belongs in this demo. Wallet login, sessions/RBAC, API client generation,
live invoice issuance, provider quotes, signatures, reconciliation, encrypted
payroll import and authoritative audit feeds remain required integration work.
OpenAPI is unchanged because no backend endpoint changed.

Keyboard access, modal focus containment, Escape dismissal, reduced-motion
preferences, responsive layouts, no external service calls and primary demo
interactions are covered by Playwright. Test configuration follows the official
[Playwright web-server documentation](https://playwright.dev/docs/test-webserver)
and [motion emulation options](https://playwright.dev/docs/api/class-testoptions).
These Chromium tests do not constitute full WCAG, Safari or Firefox validation.
