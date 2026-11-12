"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon, Mark } from "@/components/coffer/icon";
import {
  ApiError,
  cofferApi,
  type PublicInvoice,
  type PublicPayment,
} from "@/lib/coffer-api";
import { assetLabel, formatAtomic } from "@/lib/atomic";

export function PublicInvoicePayment({ publicToken }: { publicToken: string }) {
  const { session, signInWithWallet, signInvoicePayment, status } = useAuth();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    cofferApi
      .publicInvoice(publicToken)
      .then((value) => active && setInvoice(value))
      .catch((cause) => {
        if (!active) return;
        setLoadError(
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

  const pay = async () => {
    if (!invoice) return;
    const signer = session?.wallets.find(
      ({ network }) => network === "testnet",
    )?.accountId;
    if (!signer) {
      toast.error("Connect and verify a NEAR wallet before paying.");
      return;
    }
    setBusy(true);
    try {
      const prepared = await cofferApi.preparePublicNearPayment(
        publicToken,
        signer,
        crypto.randomUUID(),
      );
      const transactionHash = await signInvoicePayment(invoice, prepared);
      const settled = await cofferApi.submitPublicNearPayment(
        publicToken,
        prepared.payment.id,
        transactionHash,
      );
      setPayment(settled);
      setInvoice(await cofferApi.publicInvoice(publicToken));
      toast.success("Payment verified on NEAR and applied to the invoice.");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError && cause.code === "UNAVAILABLE"
          ? "Live testnet settlement is not enabled on the API."
          : "The payment was not credited. No unverified transfer was accepted.",
      );
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
          <p>{loadError}</p>
          <Link href="/">Return to Coffer</Link>
        </section>
      </main>
    );

  const decimals = invoice.currency === "near:testnet:native" ? 24 : 6;
  const payable =
    invoice.status === "ISSUED" &&
    invoice.outstandingAmountAtomic !== "0" &&
    invoice.currency.startsWith("near:testnet:");
  return (
    <main className="payer-page">
      <nav className="payer-nav">
        <Link className="brand" href="/">
          <Mark /> coffer.
        </Link>
        <span>
          <i /> VERIFIED PAYMENT
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
              <dd>{invoice.paymentState.replaceAll("_", " ")}</dd>
            </div>
          </dl>
          <p className="privacy-line">
            <Icon name="shield" size={16} />
            Customer identity and workspace metadata are excluded from this
            payment page.
          </p>
        </article>

        <aside className="payer-console">
          <div className="payer-step">
            <span>01</span>
            <div>
              <small>WALLET</small>
              <h2>Approve the exact invoice amount.</h2>
            </div>
          </div>
          <div className="payer-form">
            <p>
              Coffer credits this invoice only after the final NEAR transaction
              matches the signer, recipient, asset, and atomic amount below.
            </p>
            <dl>
              <div>
                <dt>Signer</dt>
                <dd>{session?.wallets[0]?.accountId ?? "Not connected"}</dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd>{invoice.payeeDestination}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{invoice.outstandingAmountAtomic} atomic</dd>
              </div>
            </dl>
            {status !== "authenticated" ? (
              <button
                className="button dark large"
                disabled={status === "loading" || status === "authenticating"}
                onClick={() => void signInWithWallet()}
              >
                Connect NEAR wallet <Icon name="arrow" size={17} />
              </button>
            ) : (
              <button
                className="button dark large"
                disabled={!payable || busy}
                onClick={() => void pay()}
              >
                {busy ? "Verifying payment…" : "Pay with NEAR wallet"}
                <Icon name="shield" size={17} />
              </button>
            )}
            {!payable && invoice.paymentState !== "PAID" && (
              <p>This invoice asset is not enabled for wallet settlement.</p>
            )}
            {payment?.status === "SETTLED" && (
              <p role="status">
                <strong>Settlement verified.</strong> The immutable payment
                record is now linked to this invoice.
              </p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
