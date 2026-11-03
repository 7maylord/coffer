# ADR-0007: Invoice publication and verified settlement state

- Status: accepted
- Date: 2026-10-30
- Related: COF-201, FR-INV-001-003, FR-PAY-006, T-ID-05, J-01, Gate G2 API foundation

## Context

An invoice link must be usable without organization membership while revealing
no customer contact details, internal metadata, tenant identifiers, or adjacent
business records. Invoice status also cannot be changed to paid by an operator,
frontend callback, or unverified provider status.

## Decision

Finance creates an exact-integer draft whose total is derived from bounded line
amounts. Draft material may be replaced and increments the revision. Issue
freezes the invoice number, customer, asset, payee, due date, metadata, line
items, and total. Issued invoices may expire after their due date or be voided;
there is no manual paid action.

Creation returns a 256-bit public token once and stores only its SHA-256 digest.
The public read endpoint accepts only the token and returns invoice number, lifecycle
and payment state, canonical asset, exact totals, payee, due date, and line
items. It omits customer data, metadata, organization and user identifiers,
payment identifiers, and the token digest. Draft and void invoices are hidden.

Token-scoped mock quote and payment endpoints use the same bearer capability.
They resolve the full invoice only inside the service, derive organization,
invoice, destination asset, outstanding amount, and recipient on the server,
and accept only source asset, refund destination, slippage and a demo scenario
from the payer. Public responses remove organization and invoice identifiers and
the quote request digest. Initiation verifies the quote's invoice binding before
creating an attempt; payment reads and mock polling also require the attempt to
belong to the token invoice. These endpoints never enable a live adapter.

An invoice-linked quote stores the invoice ID and must match its canonical
destination asset and payee. Its expected amount must be positive and no more
than the current outstanding amount. Initiation repeats those checks so a stale
quote cannot bypass an intervening payment or lifecycle change.

The serializable settlement transaction that accepts independently verified
`SETTLED` evidence also increments `verifiedReceivedAtomic`. The invoice becomes
`PAID` only when verified net received reaches its exact total. Multiple attempts
support partial payment, and concurrent previously valid attempts can expose an
explicit `OVERPAID` payment state. Unknown, underfunded, failed, expired, and
refunded attempts do not increase received value or mark the invoice paid.

## Consequences

Organization reads remain tenant scoped and role checked. Public possession of
one high-entropy token grants only its deliberately reduced invoice and mock
payment capability. The browser supports the complete J-01 mock settlement path
and explicitly calls its confirmation mock authorization. It does not request a
wallet signature. Real wallet signing, notifications, automatic expiry
scheduling, bearer-token rotation, credit notes, and post-settlement refund
reopening belong to later tickets.

No wallet signing, provider call, transfer, deployment, secret, or live network
operation is enabled by this decision.
