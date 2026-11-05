"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";
import { Modal } from "@/components/coffer/workspace";
import {
  ApiError,
  cofferApi,
  type CreateInvoiceInput,
  type Invoice,
} from "@/lib/coffer-api";
import { assetLabel, formatAtomic, parseAtomic } from "@/lib/atomic";
import { canWriteInvoices } from "@/lib/workspace-access";

const DECIMALS = 6;
const CURRENCY = "mock:near:usdc";

type DraftValues = {
  invoiceNumber: string;
  customer: string;
  email: string;
  description: string;
  amount: string;
  dueDate: string;
  payeeDestination: string;
};

const emptyDraft = (): DraftValues => ({
  invoiceNumber: `INV-${new Date().getUTCFullYear()}-`,
  customer: "",
  email: "",
  description: "",
  amount: "",
  dueDate: "",
  payeeDestination: "",
});

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CONFLICT")
      return "That invoice changed or cannot make this transition.";
    if (error.code === "FORBIDDEN") return "Your role cannot change invoices.";
    if (error.code === "UNAVAILABLE") return "The Coffer API is unavailable.";
  }
  if (error instanceof Error) return error.message;
  return "The request could not be completed.";
}

function storedToken(invoiceId: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(`coffer:invoice-token:${invoiceId}`);
}

function saveToken(invoiceId: string, token: string): void {
  sessionStorage.setItem(`coffer:invoice-token:${invoiceId}`, token);
}

function InvoiceStatus({ invoice }: { invoice: Invoice }) {
  const label =
    invoice.status === "ISSUED" ? invoice.paymentState : invoice.status;
  return (
    <span className={`api-status is-${label.toLowerCase()}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}

export function AuthenticatedInvoices() {
  const { currentOrganization } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const [values, setValues] = useState<DraftValues>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const organizationId = currentOrganization?.id;
  const canWrite = currentOrganization
    ? canWriteInvoices(currentOrganization.role)
    : false;
  const selected =
    invoices.find((invoice) => invoice.id === selectedId) ?? null;
  const token = selected ? storedToken(selected.id) : null;

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      setInvoices(await cofferApi.invoices(organizationId));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    cofferApi
      .invoices(organizationId)
      .then((next) => {
        if (active) setInvoices(next);
      })
      .catch((cause) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  const totals = useMemo(
    () => ({
      outstanding: invoices.reduce(
        (sum, invoice) => sum + BigInt(invoice.outstandingAmountAtomic),
        0n,
      ),
      received: invoices.reduce(
        (sum, invoice) => sum + BigInt(invoice.verifiedReceivedAtomic),
        0n,
      ),
      drafts: invoices.filter((invoice) => invoice.status === "DRAFT").length,
    }),
    [invoices],
  );

  const openEdit = (invoice: Invoice) => {
    const first = invoice.lineItems[0];
    setValues({
      invoiceNumber: invoice.invoiceNumber,
      customer: invoice.customer.displayName,
      email: invoice.customer.email ?? "",
      description: first?.description ?? "",
      amount: first ? formatAtomic(first.amountAtomic, DECIMALS) : "",
      dueDate: invoice.dueDate.slice(0, 10),
      payeeDestination: invoice.payeeDestination,
    });
    setEditor("edit");
    setError("");
  };

  const input = (): CreateInvoiceInput => ({
    invoiceNumber: values.invoiceNumber.trim(),
    currency: CURRENCY,
    payeeDestination: values.payeeDestination.trim(),
    customer: {
      displayName: values.customer.trim(),
      ...(values.email.trim() ? { email: values.email.trim() } : {}),
    },
    lineItems: [
      {
        description: values.description.trim(),
        amountAtomic: parseAtomic(values.amount, DECIMALS),
      },
    ],
    metadata: {},
    dueDate: new Date(`${values.dueDate}T23:59:59.000Z`).toISOString(),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      if (editor === "edit" && selected) {
        const updated = await cofferApi.updateInvoice(
          organizationId,
          selected.id,
          input(),
        );
        setInvoices((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      } else {
        const created = await cofferApi.createInvoice(organizationId, input());
        saveToken(created.invoice.id, created.publicToken);
        setInvoices((current) => [created.invoice, ...current]);
        setSelectedId(created.invoice.id);
      }
      setEditor(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const transition = async (action: "issue" | "void") => {
    if (!organizationId || !selected) return;
    setBusy(true);
    setError("");
    try {
      const updated =
        action === "issue"
          ? await cofferApi.issueInvoice(organizationId, selected.id)
          : await cofferApi.voidInvoice(organizationId, selected.id);
      setInvoices((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">REVENUE · VERIFIED END TO END</span>
          <h1>
            Make it <em>official.</em>
          </h1>
          <p>
            Draft precisely, issue once, and mark paid only after verified
            settlement.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button"
            onClick={() => void load()}
            disabled={loading}
          >
            <Icon name="refresh" size={16} /> Refresh
          </button>
          {canWrite && (
            <button
              className="button dark"
              onClick={() => {
                setValues(emptyDraft());
                setSelectedId(null);
                setEditor("create");
                setError("");
              }}
            >
              <Icon name="plus" size={17} /> Create invoice
            </button>
          )}
        </div>
      </header>

      <div className="invoice-api-stats">
        <article>
          <span>Outstanding</span>
          <strong>
            {formatAtomic(totals.outstanding.toString(), DECIMALS)}
          </strong>
          <small>{assetLabel(CURRENCY)}</small>
        </article>
        <article>
          <span>Verified received</span>
          <strong>{formatAtomic(totals.received.toString(), DECIMALS)}</strong>
          <small>Reconciled evidence only</small>
        </article>
        <article>
          <span>Drafts</span>
          <strong>{totals.drafts}</strong>
          <small>Editable until issued</small>
        </article>
      </div>

      {error && !editor && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      <section className="panel api-invoice-panel" aria-busy={loading}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">BACKEND RECORDS</span>
            <h2>Invoices</h2>
          </div>
          <span className="api-mode">MOCK SETTLEMENT</span>
        </div>
        {loading ? (
          <p className="api-empty">Loading tenant-scoped invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="api-empty">
            No invoices yet. Create the first exact-amount draft.
          </p>
        ) : (
          <div className="api-invoice-list">
            {invoices.map((invoice) => (
              <button
                key={invoice.id}
                onClick={() => setSelectedId(invoice.id)}
              >
                <span>
                  <strong>{invoice.customer.displayName}</strong>
                  <small>{invoice.invoiceNumber}</small>
                </span>
                <span className="api-invoice-amount">
                  <strong>
                    {formatAtomic(invoice.totalAmountAtomic, DECIMALS)}
                  </strong>
                  <small>{assetLabel(invoice.currency)}</small>
                </span>
                <span>
                  <InvoiceStatus invoice={invoice} />
                  <small>
                    Due {new Date(invoice.dueDate).toLocaleDateString()}
                  </small>
                </span>
                <Icon name="northeast" size={16} />
              </button>
            ))}
          </div>
        )}
      </section>

      {editor && (
        <Modal
          wide
          title={editor === "edit" ? "Refine the draft." : "A clear request."}
          close={() => setEditor(null)}
        >
          <span className="eyebrow">EXACT AMOUNTS · MOCK USDC</span>
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <div className="form-grid">
              <label>
                Invoice number
                <input
                  required
                  maxLength={64}
                  value={values.invoiceNumber}
                  onChange={(event) =>
                    setValues({ ...values, invoiceNumber: event.target.value })
                  }
                />
              </label>
              <label>
                Due date
                <input
                  required
                  type="date"
                  value={values.dueDate}
                  onChange={(event) =>
                    setValues({ ...values, dueDate: event.target.value })
                  }
                />
              </label>
              <label>
                Customer name
                <input
                  required
                  maxLength={100}
                  value={values.customer}
                  onChange={(event) =>
                    setValues({ ...values, customer: event.target.value })
                  }
                />
              </label>
              <label>
                Customer email · optional
                <input
                  type="email"
                  value={values.email}
                  onChange={(event) =>
                    setValues({ ...values, email: event.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Line item
              <input
                required
                maxLength={200}
                value={values.description}
                onChange={(event) =>
                  setValues({ ...values, description: event.target.value })
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Amount · Mock USDC
                <input
                  required
                  inputMode="decimal"
                  placeholder="2500.00"
                  value={values.amount}
                  onChange={(event) =>
                    setValues({ ...values, amount: event.target.value })
                  }
                />
              </label>
              <label>
                NEAR recipient
                <input
                  required
                  maxLength={200}
                  placeholder="treasury.testnet"
                  value={values.payeeDestination}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      payeeDestination: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <p className="quiet-note">
              <Icon name="shield" size={16} />
              Values become integer atomic units. The draft remains editable
              until issuance.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="button dark" disabled={busy}>
                {busy
                  ? "Saving…"
                  : editor === "edit"
                    ? "Save draft"
                    : "Create draft"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selected && !editor && (
        <Modal
          wide
          title={selected.customer.displayName}
          close={() => setSelectedId(null)}
        >
          <span className="eyebrow">{selected.invoiceNumber}</span>
          <div className="invoice-detail-grid">
            <div className="invoice-paper">
              <div className="invoice-paper-top">
                <span className="brand">coffer.</span>
                <InvoiceStatus invoice={selected} />
              </div>
              {selected.lineItems.map((item) => (
                <div
                  className="invoice-line"
                  key={`${item.description}:${item.amountAtomic}`}
                >
                  <span>{item.description}</span>
                  <strong>{formatAtomic(item.amountAtomic, DECIMALS)}</strong>
                </div>
              ))}
              <div className="invoice-total">
                <span>Total · {assetLabel(selected.currency)}</span>
                <strong>
                  {formatAtomic(selected.totalAmountAtomic, DECIMALS)}
                </strong>
              </div>
              <small>
                Due {new Date(selected.dueDate).toLocaleString()} · recipient{" "}
                {selected.payeeDestination}
              </small>
            </div>
            <aside className="invoice-evidence">
              <span className="eyebrow">SETTLEMENT EVIDENCE</span>
              <dl>
                <div>
                  <dt>Verified</dt>
                  <dd>
                    {formatAtomic(selected.verifiedReceivedAtomic, DECIMALS)}
                  </dd>
                </div>
                <div>
                  <dt>Outstanding</dt>
                  <dd>
                    {formatAtomic(selected.outstandingAmountAtomic, DECIMALS)}
                  </dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{selected.revision}</dd>
                </div>
              </dl>
              {selected.paymentAttempts.length ? (
                selected.paymentAttempts.map((attempt) => (
                  <div className="attempt-row" key={attempt.id}>
                    <span>{attempt.status.replaceAll("_", " ")}</span>
                    <small>
                      {attempt.settledAt
                        ? `Verified ${new Date(attempt.settledAt).toLocaleString()}`
                        : "Awaiting terminal evidence"}
                    </small>
                  </div>
                ))
              ) : (
                <p>No payment attempts yet.</p>
              )}
            </aside>
          </div>
          {selected.status === "ISSUED" && token && (
            <div className="hosted-link">
              <div>
                <span className="eyebrow">HOSTED PAYMENT</span>
                <p>
                  This token is shown only in the browser session that created
                  the invoice.
                </p>
              </div>
              <Link
                className="button dark"
                href={`/pay/${token}`}
                target="_blank"
              >
                Open payer view <Icon name="northeast" size={16} />
              </Link>
            </div>
          )}
          {selected.status === "ISSUED" && !token && (
            <p className="form-alert">
              The hosted token is not recoverable after this browser session.
              Create-and-issue flows retain it only for immediate sharing.
            </p>
          )}
          <div className="modal-actions">
            {canWrite && selected.status === "DRAFT" && (
              <>
                <button className="button" onClick={() => openEdit(selected)}>
                  Edit draft
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void transition("void")}
                >
                  Void
                </button>
                <button
                  className="button dark"
                  disabled={busy || !token}
                  onClick={() => void transition("issue")}
                >
                  {busy ? "Issuing…" : "Issue invoice"}
                </button>
              </>
            )}
            {canWrite && selected.status === "ISSUED" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => void transition("void")}
              >
                Void invoice
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
