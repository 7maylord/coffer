# Coffer documentation

This directory keeps the material needed to understand, run, review, and
present Coffer. The canonical sources are Markdown and HTML; generated exports
are intentionally not committed.

## Start here

| Need | Read |
| --- | --- |
| Understand the product, local setup, and safety boundary | [root README](../README.md) |
| Review product requirements and non-negotiable controls | [PRD/TRD](../COFFER_PRD_TRD.md) |
| See the delivery sequence and open release gates | [implementation plan](implementation-plan.md) |
| Compare provider capabilities and integration boundaries | [provider matrix](provider-matrix.md) |
| Reproduce the judge/demo walkthrough | [demo script](demo-script.md) |
| Prepare the five-slide pitch | [pitch-deck script](pitch-deck-script.md) and [HTML deck](coffer-pitch-deck.html) |
| Complete publication and submission tasks | [submission checklist](submission-checklist.md) |

## Technical evidence

- [Research onboarding](research-onboarding.md) records the initial NEAR and
  provider research.
- [Threat model](threat-model.md) and [backend hardening](backend-hardening.md)
  cover application controls and outstanding review requirements.
- [G4 evidence](g4-evidence.md) records the demonstrated end-to-end and
  testnet evidence.
- [OpenAPI contract](api/openapi.json) is generated from the backend controller
  metadata; regenerate it with `pnpm --dir backend openapi:generate`.
- [Design audit](design/f07-audit.md) and `design/screenshots/` retain the
  frontend accessibility and responsive-review evidence.

## Architecture decisions

The numbered records in [adr/](adr/) are the decision history. Read them in
numeric order when reviewing the architecture; the highest-numbered relevant
record is the latest decision on that concern.

## Documentation hygiene

- Keep factual claims tied to reproducible code, test evidence, or an official
  provider source.
- Keep synthetic payroll data, wallet keys, credentials, and personal data out
  of documents and screenshots.
- Update the relevant README, ADR, OpenAPI artifact, and submission checklist
  when an implementation boundary changes.
