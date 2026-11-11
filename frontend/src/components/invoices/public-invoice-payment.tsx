"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon, Mark } from "@/components/coffer/icon";
import { StateToast } from "@/components/ui/state-toast";
import {
  ApiError,
  cofferApi,
  type PublicInvoice,
  type PublicPayment,
  type PublicQuote,
  type SettlementAssets,
} from "@/lib/coffer-api";
import { assetLabel, formatAtomic } from "@/lib/atomic";

const terminal = new Set<PublicPayment["status"]>([
  "SETTLED",
  "REFUNDED",
  "FAILED",
  "EXPIRED",
  "UNDERFUNDED",
  "UNKNOWN_REQUIRES_RECONCILIATION",
]);

function paymentMessage(status: PublicPayment["status"]): string {
  if (status === "SETTLED")
    return "Verified settlement received. The invoice record can now become paid.";
  if (status === "REFUNDED")
    return "The mock route refunded the source amount. The invoice remains unpaid.";
  if (status === "UNDERFUNDED")
    return "The deposit was incomplete. The invoice remains open for reconciliation.";
  if (status === "UNKNOWN_REQUIRES_RECONCILIATION")
    return "Provider status is unknown. Coffer refuses to assume success.";
  if (status === "FAILED" || status === "EXPIRED")
    return "This attempt ended without settlement.";
  return "Coffer is waiting for independently verified settlement evidence.";
}

export function PublicInvoicePayment({ publicToken }: { publicToken: string }) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [assets, setAssets] = useState<SettlementAssets | null>(null);
  const [source, setSource] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [scenario, setScenario] = useState<
    | "success"
    | "refund"
    | "unknown"
    | "partial_deposit"
    | "status_delay"
    | "duplicate_callback"
  >("success");
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshInvoice = async () =>
    setInvoice(await cofferApi.publicInvoice(publicToken));

  useEffect(() => {
    let active = true;
    Promise.all([
      cofferApi.publicInvoice(publicToken),
      cofferApi.publicSettlementAssets(publicToken),
    ])
      .then(([nextInvoice, nextAssets]) => {
        if (!active) return;
        setInvoice(nextInvoice);
        setAssets(nextAssets);
        setSource(
          nextAssets.assets.find((asset) => asset.id !== nextInvoice.currency)
            ?.id ?? "",
        );
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "This invoice link is invalid or no longer available."
            : "The invoice could not be loaded.",
        );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [publicToken]);

  const decimals = useMemo(
    () =>
      assets?.assets.find((asset) => asset.id === invoice?.currency)
        ?.decimals ?? 6,
    [assets, invoice],
  );

  const createQuote = async () => {
    setBusy(true);
    setError("");
    try {
      setQuote(
        await cofferApi.createPublicQuote(publicToken, {
          sourceAssetId: source,
          refundTo: refundTo.trim(),
          slippageBps: 50,
          scenario,
        }),
      );
    } catch {
      setError(
        "The mock quote could not be created. Check the refund destination and invoice state.",
      );
    } finally {
      setBusy(false);
    }
  };

  const authorize = async () => {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      setPayment(
        await cofferApi.initiatePublicPayment(
          publicToken,
          quote.id,
          crypto.randomUUID(),
        ),
      );
    } catch {
      setError(
        "The mock authorization could not be recorded. The quote may have expired.",
      );
    } finally {
      setBusy(false);
    }
  };

  const poll = async () => {
    if (!payment) return;
    setBusy(true);
    setError("");
    try {
      const next = await cofferApi.pollPublicPayment(publicToken, payment.id);
      setPayment(next);
      if (terminal.has(next.status)) await refreshInvoice();
    } catch {
      setError("Coffer could not refresh the settlement evidence.");
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <main className="payer-page">
        <p aria-busy="true">Opening the invoice…</p>
      </main>
    );
  if (!invoice)
    return (
      <main className="payer-page">
        <section className="payer-error">
          <Mark />
          <h1>Invoice unavailable.</h1>
          <p>{error}</p>
          <Link href="/">Return to Coffer</Link>
        </section>
      </main>
    );

  const payable =
    invoice.status === "ISSUED" && invoice.outstandingAmountAtomic !== "0";
  return (
    <main className="payer-page">
      <nav className="payer-nav">
        <Link className="brand" href="/">
          <Mark /> coffer.
        </Link>
        <span>
          <i /> MOCK PAYMENT LAB
        </span>
      </nav>
      <section className="payer-shell">
        <article className="payer-invoice">
          <div className="payer-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="eyebrow">INVOICE {invoice.invoiceNumber}</span>
          <h1>
            A clear request.
            <br />
            <em>A verifiable finish.</em>
          </h1>
          <div className="payer-total">
            <small>Amount due</small>
            <strong>
              {formatAtomic(invoice.outstandingAmountAtomic, decimals)}
            </strong>
            <span>{assetLabel(invoice.currency)}</span>
          </div>
          <div className="payer-lines">
            {invoice.lineItems.map((item) => (
              <div key={`${item.description}:${item.amountAtomic}`}>
                <span>{item.description}</span>
                <strong>{formatAtomic(item.amountAtomic, decimals)}</strong>
              </div>
            ))}
          </div>
          <dl className="payer-meta">
            <div>
              <dt>Recipient</dt>
              <dd>{invoice.payeeDestination}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{new Date(invoice.dueDate).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Invoice state</dt>
              <dd>
                {invoice.status} · {invoice.paymentState.replaceAll("_", " ")}
              </dd>
            </div>
          </dl>
          <p className="privacy-line">
            <Icon name="shield" size={16} />
            The hosted view excludes customer identity, email, workspace,
            creator and metadata.
          </p>
        </article>

        <aside className="payer-console">
          <div className="payer-step">
            <span>01</span>
            <div>
              <small>ROUTE</small>
              <h2>Choose the mock source.</h2>
            </div>
          </div>
          {!payment && !quote && (
            <div className="payer-form">
              <label>
                Pay from
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  {assets?.assets
                    .filter((asset) => asset.id !== invoice.currency)
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {assetLabel(asset.id)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Mock refund destination
                <input
                  value={refundTo}
                  onChange={(event) => setRefundTo(event.target.value)}
                  placeholder="payer.testnet"
                />
              </label>
              <label>
                Demo settlement outcome
                <select
                  value={scenario}
                  onChange={(event) =>
                    setScenario(event.target.value as typeof scenario)
                  }
                >
                  <option value="success">Verified settlement</option>
                  <option value="refund">Refund</option>
                  <option value="unknown">Unknown status</option>
                  <option value="partial_deposit">Underfunded</option>
                  <option value="status_delay">Delayed settlement</option>
                  <option value="duplicate_callback">Duplicate callback</option>
                </select>
              </label>
              <p className="mock-disclosure">
                <strong>Simulation only.</strong> This does not open a wallet,
                request a signature, or move testnet/mainnet funds.
              </p>
              <button
                className="button dark large"
                disabled={!payable || busy || !source || !refundTo.trim()}
                onClick={() => void createQuote()}
              >
                {busy ? "Building quote…" : "Review mock quote"}
                <Icon name="arrow" size={17} />
              </button>
            </div>
          )}

          {quote && !payment && (
            <div className="quote-card">
              <div className="payer-step">
                <span>02</span>
                <div>
                  <small>REVIEW</small>
                  <h2>Everything before authorization.</h2>
                </div>
              </div>
              <dl>
                <div>
                  <dt>You provide</dt>
                  <dd>
                    {formatAtomic(quote.amountAtomic, decimals)} ·{" "}
                    {assetLabel(quote.sourceAssetId)}
                  </dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>
                    {formatAtomic(quote.expectedAmountAtomic, decimals)} ·{" "}
                    {assetLabel(quote.destinationAssetId)}
                  </dd>
                </div>
                <div>
                  <dt>Mock fee</dt>
                  <dd>0</dd>
                </div>
                <div>
                  <dt>Slippage limit</dt>
                  <dd>{quote.slippageBps} bps</dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>{quote.recipient}</dd>
                </div>
                <div>
                  <dt>Refund to</dt>
                  <dd>{quote.refundTo}</dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>{quote.confidentiality}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{new Date(quote.expiresAt).toLocaleTimeString()}</dd>
                </div>
              </dl>
              <button
                className="button dark large"
                disabled={busy}
                onClick={() => void authorize()}
              >
                {busy ? "Recording…" : "Authorize mock payment"}
                <Icon name="shield" size={17} />
              </button>
              <button className="text-link" onClick={() => setQuote(null)}>
                Change route
              </button>
            </div>
          )}

          {payment && (
            <div className="payment-track">
              <div className="payer-step">
                <span>03</span>
                <div>
                  <small>RECONCILE</small>
                  <h2>{payment.status.replaceAll("_", " ")}</h2>
                </div>
              </div>
              <p className="payment-explanation">
                {paymentMessage(payment.status)}
              </p>
              <ol>
                {payment.history.map((item) => (
                  <li
                    key={item.eventId}
                    className={item.status === payment.status ? "active" : ""}
                  >
                    <i />
                    <span>
                      {item.status.replaceAll("_", " ")}
                      <small>
                        {new Date(item.observedAt).toLocaleTimeString()}
                      </small>
                    </span>
                  </li>
                ))}
              </ol>
              {!terminal.has(payment.status) && (
                <button
                  className="button dark large"
                  disabled={busy}
                  onClick={() => void poll()}
                >
                  {busy ? "Checking evidence…" : "Check settlement"}
                  <Icon name="refresh" size={17} />
                </button>
              )}
              {terminal.has(payment.status) && (
                <div
                  className={`terminal-card is-${payment.status.toLowerCase()}`}
                >
                  <strong>
                    {payment.status === "SETTLED" ? "Reconciled" : "Not paid"}
                  </strong>
                  <span>
                    Settlement postings: {payment.settlementPostingCount} ·
                    refunds: {payment.refundPostingCount}
                  </span>
                </div>
              )}
            </div>
          )}
          <StateToast id="public-invoice-error" message={error} />
        </aside>
      </section>
      <footer className="payer-footer">
        <span>Bearer-link access · share carefully</span>
        <span>Provider: deterministic mock adapter</span>
        <span>No private payment claim</span>
      </footer>
    </main>
  );
}
