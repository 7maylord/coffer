# G5 submission review checklist

## Code-owned evidence

- [x] Frontend/backend are separate pnpm projects; contracts are separate Cargo packages.
- [x] Synthetic demo seed is idempotent and local database reset is explicitly guarded.
- [x] Architecture and seven-minute demo narrative are documented.
- [x] Twenty-two current desktop/mobile screenshots are retained and inspected.
- [x] Mock/live/unverified/private states are labelled without implying fund movement.
- [x] Chromium responsive, keyboard, axe, regression, type, lint, and build checks have local evidence.
- [ ] Independent human contract/application security review has signed off with no unresolved critical/high finding.
- [ ] Fresh clone/install has been repeated from the final public revision on a clean machine.
- [ ] Hosted CI has passed on the exact submission revision.
- [ ] Manual screen-reader checks and Safari/Firefox regression have passed.

## Owner-controlled actions — do not automate

- [x] MIT license added at the repository root; confirm third-party asset/code provenance before publication.
- [ ] Approve and publish the repository; verify that secrets and private history are absent.
- [ ] Record the demo video using only synthetic data and truthful evidence labels.
- [ ] Publish the required X post and retain its public URL.
- [ ] Verify every track/form link, repository URL, video URL, and transaction/explorer link.
- [ ] If testnet evidence is included, manually confirm network, signer, receiver, asset, exact amount, finality, and explorer URL.
- [ ] Submit before the official deadline and retain the confirmation receipt.

Do not check a live/deployment item from a screenshot or mocked test. G5 is not
a production/compliance/security release gate.
