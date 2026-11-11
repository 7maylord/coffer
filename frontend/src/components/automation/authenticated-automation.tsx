"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";
import { StateToast } from "@/components/ui/state-toast";
import {
  ApiError,
  cofferApi,
  type Agent,
  type AgentWorkspace,
  type CfoProposal,
  type CfoWorkspace,
  type Invoice,
  type TreasuryWorkspace,
} from "@/lib/coffer-api";
import { formatAtomic, parseAtomic } from "@/lib/atomic";
import {
  canApproveAgentPurchase,
  canCreateCfoProposal,
  canDecideCfoProposal,
  canManageAgents,
  canPurchaseForAgent,
} from "@/lib/workspace-access";

const DECIMALS = 6;

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "FORBIDDEN")
      return "Your role or the active policy denied this action.";
    if (error.code === "UNAVAILABLE")
      return "The provider or controlled execution feature is unavailable. No purchase was made.";
    if (error.code === "CONFLICT")
      return "This offer, approval, or purchase is no longer executable.";
    if (error.code === "INVALID_RESPONSE")
      return "Coffer rejected an invalid API response.";
  }
  if (error instanceof Error) return error.message;
  return "The request could not be completed.";
}

function short(value: string): string {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function Status({ value }: { value: string }) {
  return (
    <span
      className={`api-status is-${value.toLowerCase().replaceAll("_", "-")}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

export function AuthenticatedCfo() {
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;
  const role = currentOrganization?.role;
  const [workspace, setWorkspace] = useState<CfoWorkspace | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [treasury, setTreasury] = useState<TreasuryWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apply = (
    next: CfoWorkspace,
    nextInvoices: Invoice[],
    nextTreasury: TreasuryWorkspace,
  ) => {
    setWorkspace(next);
    setInvoices(nextInvoices);
    setTreasury(nextTreasury);
    setSelectedId((current) =>
      next.proposals.some((proposal) => proposal.id === current)
        ? current
        : (next.proposals[0]?.id ?? null),
    );
    const first = nextInvoices.find(
      (invoice) =>
        invoice.status === "ISSUED" && invoice.outstandingAmountAtomic !== "0",
    );
    setInvoiceId((current) =>
      nextInvoices.some((invoice) => invoice.id === current)
        ? current
        : (first?.id ?? ""),
    );
    setAmount(
      (current) =>
        current ||
        (first ? formatAtomic(first.outstandingAmountAtomic, DECIMALS) : ""),
    );
  };

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      apply(
        ...(await Promise.all([
          cofferApi.cfoWorkspace(organizationId),
          cofferApi.invoices(organizationId),
          cofferApi.treasuryWorkspace(organizationId),
        ])),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    Promise.all([
      cofferApi.cfoWorkspace(organizationId),
      cofferApi.invoices(organizationId),
      cofferApi.treasuryWorkspace(organizationId),
    ])
      .then((result) => active && apply(...result))
      .catch((cause) => active && setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [organizationId]);

  const selected =
    workspace?.proposals.find((proposal) => proposal.id === selectedId) ?? null;
  const source = treasury?.accounts.find(
    (account) =>
      account.accountType === "ASSET" && account.assetId === "mock:near:usdc",
  );
  const canCreate = role ? canCreateCfoProposal(role) : false;
  const canDecide = role ? canDecideCfoProposal(role) : false;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !source || !invoiceId) return;
    setBusy(true);
    setError("");
    try {
      const created = await cofferApi.createCfoProposal(organizationId, {
        sourceAccountId: source.id,
        assetId: source.assetId,
        maximumAmountAtomic: parseAtomic(amount, DECIMALS),
        allowedCategories: ["Operations", "Payroll", "Growth"],
        supportingRecordIds: [invoiceId],
      });
      await load();
      setSelectedId(created.id);
      setShowCreate(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    if (!organizationId || !selected) return;
    setBusy(true);
    setError("");
    try {
      await cofferApi.decideCfoProposal(
        organizationId,
        selected.id,
        decision,
        note.trim() || undefined,
      );
      await load();
      setNote("");
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
          <span className="eyebrow">SCOPED EVIDENCE · HUMAN AUTHORITY</span>
          <h1>
            A CFO that can <em>show its work.</em>
          </h1>
          <p>
            Suggestions are schema-checked evidence. Approval reserves internal
            ledger funds; it never lets a model sign or transfer.
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
          {canCreate && (
            <button className="button dark" onClick={() => setShowCreate(true)}>
              <Icon name="plus" size={16} /> New analysis
            </button>
          )}
        </div>
      </header>

      <StateToast id="cfo-error" message={error} />

      <section
        className="automation-truth-strip"
        aria-label="Inference boundary"
      >
        <div>
          <span>Provider mode</span>
          <strong>{workspace?.providerMode ?? "—"}</strong>
          <small>
            {workspace?.nearAiEnabled
              ? "External calls enabled"
              : "External calls disabled"}
          </small>
        </div>
        <div>
          <span>Response gate</span>
          <strong>Strict schema</strong>
          <small>Exact integer bounds and selected invoice evidence</small>
        </div>
        <div className="custody-truth">
          <span>NEAR AI attestation</span>
          <strong>Not implemented</strong>
          <small>UNVERIFIED never means private or trusted</small>
        </div>
      </section>

      <div className="automation-layout">
        <section className="panel automation-rail">
          <div className="panel-heading">
            <span>Proposal evidence</span>
            <span className="api-mode">
              {workspace?.proposals.length ?? 0} RUNS
            </span>
          </div>
          {loading ? (
            <p className="api-empty" aria-busy="true">
              Loading proposals…
            </p>
          ) : !workspace?.proposals.length ? (
            <p className="api-empty">No CFO proposal has been requested.</p>
          ) : (
            <div className="automation-list">
              {workspace.proposals.map((proposal) => (
                <button
                  className={proposal.id === selectedId ? "selected" : ""}
                  key={proposal.id}
                  onClick={() => setSelectedId(proposal.id)}
                >
                  <span>
                    <strong>
                      {formatAtomic(proposal.maximumAmountAtomic, DECIMALS)}
                    </strong>
                    <small>Mock USDC maximum</small>
                  </span>
                  <span>
                    <Status value={proposal.status} />
                    <small>{proposal.allocations.length} allocations</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel automation-review">
          {selected ? (
            <CfoReview
              proposal={selected}
              invoices={invoices}
              canDecide={canDecide}
              busy={busy}
              note={note}
              setNote={setNote}
              decide={decide}
            />
          ) : (
            <p className="api-empty">
              Select or create a proposal to inspect its evidence.
            </p>
          )}
        </section>
      </div>

      {showCreate && (
        <section className="panel automation-composer">
          <div>
            <span className="eyebrow">NEW SCOPED ANALYSIS</span>
            <h2>Choose the evidence and hard ceiling.</h2>
            <p>
              The server sends structured invoice metadata only. Categories and
              maximum are authoritative bounds.
            </p>
          </div>
          <form className="form-stack" onSubmit={(event) => void create(event)}>
            <label>
              Issued invoice evidence
              <select
                required
                value={invoiceId}
                onChange={(event) => {
                  const id = event.target.value;
                  setInvoiceId(id);
                  const invoice = invoices.find((item) => item.id === id);
                  if (invoice)
                    setAmount(
                      formatAtomic(invoice.outstandingAmountAtomic, DECIMALS),
                    );
                }}
              >
                <option value="">Choose an invoice</option>
                {invoices
                  .filter((invoice) => invoice.status === "ISSUED")
                  .map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNumber} · {invoice.customer.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Maximum · Mock USDC
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                className="button"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button className="button dark" disabled={busy || !source}>
                {busy ? "Validating…" : "Request proposal"}
              </button>
            </div>
            {!source && (
              <p className="form-alert">
                A Mock USDC asset ledger account is required first.
              </p>
            )}
          </form>
        </section>
      )}
    </>
  );
}

function CfoReview({
  proposal,
  invoices,
  canDecide,
  busy,
  note,
  setNote,
  decide,
}: {
  proposal: CfoProposal;
  invoices: Invoice[];
  canDecide: boolean;
  busy: boolean;
  note: string;
  setNote: (value: string) => void;
  decide: (decision: "APPROVED" | "REJECTED") => Promise<void>;
}) {
  const invoice = invoices.find((item) =>
    proposal.supportingRecordIds.includes(item.id),
  );
  return (
    <>
      <div className="automation-review-head">
        <div>
          <span className="eyebrow">
            VALIDATED OUTPUT · {proposal.promptTemplateVersion}
          </span>
          <h2>
            {formatAtomic(proposal.maximumAmountAtomic, DECIMALS)}{" "}
            <small>Mock USDC</small>
          </h2>
        </div>
        <Status value={proposal.status} />
      </div>
      <div className="automation-warning">
        <Icon name="shield" size={18} />
        <p>
          <strong>Adversarial input boundary.</strong> Reasons and uncertainty
          are untrusted text. They cannot change the source account, amount
          ceiling, evidence IDs, destination, or execution authority.
        </p>
      </div>
      <div className="allocation-stack">
        {proposal.allocations.map((allocation, index) => (
          <article key={`${allocation.category}-${index}`}>
            <div>
              <span>{allocation.category}</span>
              <strong>{formatAtomic(allocation.amountAtomic, DECIMALS)}</strong>
            </div>
            <p>{allocation.reason}</p>
            <small>
              Confidence {allocation.confidenceBps / 100}% · Uncertainty:{" "}
              {allocation.uncertainty}
            </small>
            <Link href="/invoices">
              Evidence:{" "}
              {invoice?.invoiceNumber ??
                short(allocation.supportingRecordIds[0] ?? "missing")}
            </Link>
          </article>
        ))}
      </div>
      <div className="digest-grid">
        <div>
          <span>Provider / model</span>
          <strong>
            {proposal.provider} · {proposal.model}
          </strong>
        </div>
        <div>
          <span>Attestation</span>
          <strong>{proposal.attestationStatus}</strong>
        </div>
        <div>
          <span>Input class</span>
          <strong>{proposal.inputClassification}</strong>
        </div>
        <div>
          <span>Response</span>
          <strong>{proposal.responseValidationStatus}</strong>
        </div>
      </div>
      {proposal.reservationId && (
        <p className="automation-result">
          Internal reservation evidence · <code>{proposal.reservationId}</code>
        </p>
      )}
      {proposal.status === "PENDING" && canDecide && (
        <div className="approval-actions form-stack">
          <label>
            Decision note (optional)
            <input
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void decide("REJECTED")}
            >
              Reject
            </button>
            <button
              className="button dark"
              disabled={busy}
              onClick={() => void decide("APPROVED")}
            >
              Approve &amp; reserve
            </button>
          </div>
          <p className="form-note">
            Approval creates an internal ledger reservation only. It is not a
            wallet signature or payment.
          </p>
        </div>
      )}
    </>
  );
}

export function AuthenticatedAgents() {
  const { currentOrganization, session } = useAuth();
  const organizationId = currentOrganization?.id;
  const role = currentOrganization?.role;
  const [workspace, setWorkspace] = useState<AgentWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("Classify finance documents");
  const [maxAmount, setMaxAmount] = useState("20");
  const [budget, setBudget] = useState("50");
  const [documentCount, setDocumentCount] = useState(10);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const next = await cofferApi.agentWorkspace(organizationId);
      setWorkspace(next);
      setSelectedId((current) =>
        next.agents.some((agent) => agent.id === current)
          ? current
          : (next.agents[0]?.id ?? null),
      );
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
      .agentWorkspace(organizationId)
      .then((next) => {
        if (!active) return;
        setWorkspace(next);
        setSelectedId(next.agents[0]?.id ?? null);
      })
      .catch((cause) => active && setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [organizationId]);

  const selected =
    workspace?.agents.find((agent) => agent.id === selectedId) ?? null;
  const offers = useMemo(
    () =>
      workspace?.offers.filter((offer) => offer.agentId === selectedId) ?? [],
    [selectedId, workspace],
  );
  const purchases = useMemo(
    () =>
      workspace?.purchases.filter(
        (purchase) => purchase.agentId === selectedId,
      ) ?? [],
    [selectedId, workspace],
  );
  const canManage = role ? canManageAgents(role) : false;
  const canPurchase = role ? canPurchaseForAgent(role) : false;
  const canApprove = role ? canApproveAgentPurchase(role) : false;
  const wallet = session?.wallets.find(
    (item) => item.network === "testnet",
  )?.accountId;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) return;
    await run(() =>
      cofferApi.createAgent(organizationId, {
        purpose: purpose.trim(),
        allowedActions: ["purchase:document-classification"],
        assetId: "mock:base:usdc",
        chainId: "mock:base",
        maxAmountAtomic: parseAtomic(maxAmount, DECIMALS),
        rollingBudgetAtomic: parseAtomic(budget, DECIMALS),
        rollingWindowSeconds: 86_400,
        vendorAllowlist: ["mock-document-classifier"],
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    );
    setShowCreate(false);
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">BOUNDED AGENT COMMERCE · MOCK ONLY</span>
          <h1>
            Useful autonomy, <em>narrowly held.</em>
          </h1>
          <p>
            Fixed vendor, fixed action, exact offer digest, central policy,
            human quorum, then mock fulfillment.
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
          {canManage && (
            <button className="button dark" onClick={() => setShowCreate(true)}>
              <Icon name="plus" size={16} /> Create agent
            </button>
          )}
        </div>
      </header>

      <StateToast id="agent-error" message={error} />

      <section
        className="agent-gate"
        data-enabled={workspace?.executionEnabled ?? false}
      >
        <div>
          <span>Execution feature</span>
          <strong>
            {workspace?.executionEnabled
              ? "Manually enabled"
              : "Disabled by default"}
          </strong>
        </div>
        <p>
          {workspace?.executionEnabled
            ? "Controlled mock proposals may enter approval."
            : "Offer inspection remains available. Purchase creation and execution fail closed."}
        </p>
        <span className="api-mode">
          {workspace?.settlementMode ?? "mock"} SETTLEMENT
        </span>
      </section>

      <div className="automation-layout agent-workspace">
        <section className="panel automation-rail">
          <div className="panel-heading">
            <span>Bounded agents</span>
            <span className="api-mode">
              {workspace?.agents.length ?? 0} REGISTERED
            </span>
          </div>
          {loading ? (
            <p className="api-empty" aria-busy="true">
              Loading agents…
            </p>
          ) : !workspace?.agents.length ? (
            <p className="api-empty">No agent has been registered.</p>
          ) : (
            <div className="automation-list">
              {workspace.agents.map((agent) => (
                <button
                  className={agent.id === selectedId ? "selected" : ""}
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                >
                  <span>
                    <strong>{agent.purpose}</strong>
                    <small>{agent.vendorAllowlist[0]}</small>
                  </span>
                  <span>
                    <Status value={agent.status} />
                    <small>
                      {formatAtomic(agent.maxAmountAtomic, DECIMALS)} max
                    </small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel automation-review">
          {selected && workspace ? (
            <AgentReview
              agent={selected}
              workspace={workspace}
              offers={offers}
              purchases={purchases}
              documentCount={documentCount}
              setDocumentCount={setDocumentCount}
              canManage={canManage}
              canPurchase={canPurchase}
              canApprove={canApprove}
              wallet={wallet}
              busy={busy}
              run={run}
              organizationId={organizationId!}
            />
          ) : (
            <p className="api-empty">
              Select or create an agent to inspect its exact authority.
            </p>
          )}
        </section>
      </div>

      {showCreate && (
        <section className="panel automation-composer">
          <div>
            <span className="eyebrow">LEAST-PRIVILEGE PROFILE</span>
            <h2>One action. One vendor. Seven days.</h2>
            <p>
              The server fixes asset, chain, vendor, action and rolling window.
            </p>
          </div>
          <form className="form-stack" onSubmit={(event) => void create(event)}>
            <label>
              Purpose
              <input
                required
                maxLength={200}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </label>
            <label>
              Per-purchase maximum · Mock USDC
              <input
                required
                inputMode="decimal"
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
              />
            </label>
            <label>
              24-hour budget · Mock USDC
              <input
                required
                inputMode="decimal"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                className="button"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button className="button dark" disabled={busy}>
                {busy ? "Creating…" : "Create bounded agent"}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

function AgentReview({
  agent,
  workspace,
  offers,
  purchases,
  documentCount,
  setDocumentCount,
  canManage,
  canPurchase,
  canApprove,
  wallet,
  busy,
  run,
  organizationId,
}: {
  agent: Agent;
  workspace: AgentWorkspace;
  offers: AgentWorkspace["offers"];
  purchases: AgentWorkspace["purchases"];
  documentCount: number;
  setDocumentCount: (value: number) => void;
  canManage: boolean;
  canPurchase: boolean;
  canApprove: boolean;
  wallet?: string;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
  organizationId: string;
}) {
  const offer = offers[0];
  const purchase = purchases[0];
  const proposal = purchase?.financialProposal;
  const approvedByCurrent = proposal?.approvals.some(
    (item) => item.approverNearAccountId === wallet,
  );
  return (
    <>
      <div className="automation-review-head">
        <div>
          <span className="eyebrow">{agent.provider}</span>
          <h2>{agent.purpose}</h2>
        </div>
        <Status value={agent.status} />
      </div>
      <div className="agent-authority-grid">
        <div>
          <span>Per purchase</span>
          <strong>{formatAtomic(agent.maxAmountAtomic, DECIMALS)}</strong>
        </div>
        <div>
          <span>24h budget</span>
          <strong>{formatAtomic(agent.rollingBudgetAtomic, DECIMALS)}</strong>
        </div>
        <div>
          <span>Action</span>
          <strong>Document classification</strong>
        </div>
        <div>
          <span>Vendor</span>
          <strong>{agent.vendorAllowlist[0]}</strong>
        </div>
      </div>
      <div className="automation-warning">
        <Icon name="shield" size={18} />
        <p>
          <strong>Vendor text has no authority.</strong> Coffer accepts only the
          typed price, terms, digest and pre-registered recipient commitment.
          Arbitrary URLs and changed destinations are rejected.
        </p>
      </div>

      {agent.status === "ACTIVE" && (
        <>
          <div className="agent-control-row">
            {canManage && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    cofferApi.activateAgentPolicy(organizationId, agent.id),
                  )
                }
              >
                Activate central policy
              </button>
            )}
            {canPurchase && (
              <>
                <label>
                  Documents
                  <input
                    aria-label="Documents"
                    type="number"
                    min={1}
                    max={100}
                    value={documentCount}
                    onChange={(event) =>
                      setDocumentCount(event.target.valueAsNumber)
                    }
                  />
                </label>
                <button
                  className="button dark"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      cofferApi.requestAgentOffer(
                        organizationId,
                        agent.id,
                        documentCount,
                        "financial",
                      ),
                    )
                  }
                >
                  Request structured offer
                </button>
              </>
            )}
            {canManage && (
              <button
                className="button danger"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    cofferApi.revokeAgent(organizationId, agent.id),
                  )
                }
              >
                Revoke
              </button>
            )}
          </div>
          {canManage && (
            <p className="form-note">
              Policy activation publishes a new version, expires no later than
              this agent, and can make older pending proposals stale.
            </p>
          )}
        </>
      )}

      {offer && (
        <section className="structured-offer">
          <div className="panel-heading">
            <span>Structured vendor offer</span>
            <span className="api-mode">CONTROLLED FIELDS</span>
          </div>
          <dl>
            <div>
              <dt>Price</dt>
              <dd>{formatAtomic(offer.priceAtomic, DECIMALS)} Mock USDC</dd>
            </div>
            <div>
              <dt>Deliverable</dt>
              <dd>{offer.controlledTerms.deliverable}</dd>
            </div>
            <div>
              <dt>Documents</dt>
              <dd>{offer.controlledTerms.documentCount}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>
                <code>{short(offer.recipientCommitment)}</code>
              </dd>
            </div>
            <div>
              <dt>Offer digest</dt>
              <dd>
                <code>{short(offer.offerDigest)}</code>
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{new Date(offer.expiresAt).toLocaleString()}</dd>
            </div>
          </dl>
          {canPurchase && !purchase && (
            <button
              className="button dark"
              disabled={busy || !workspace.executionEnabled}
              onClick={() =>
                void run(() =>
                  cofferApi.createAgentPurchase(
                    organizationId,
                    agent.id,
                    offer.id,
                  ),
                )
              }
            >
              {workspace.executionEnabled
                ? "Send exact offer to policy"
                : "Execution feature is disabled"}
            </button>
          )}
        </section>
      )}

      {purchase && (
        <section className="purchase-evidence">
          <div>
            <span>Purchase state</span>
            <Status value={purchase.status} />
          </div>
          {proposal && (
            <>
              <div className="quorum-track">
                <span>Human quorum · policy v{proposal.policyVersion}</span>
                <div>
                  {Array.from(
                    { length: proposal.approvalThreshold },
                    (_, index) => (
                      <i
                        className={
                          index < proposal.approvals.length ? "filled" : ""
                        }
                        key={index}
                      />
                    ),
                  )}
                </div>
                <strong>
                  {proposal.approvals.length} / {proposal.approvalThreshold}
                </strong>
              </div>
              <div className="digest-grid">
                <div>
                  <span>Policy digest</span>
                  <code>{short(proposal.policyDigest)}</code>
                </div>
                <div>
                  <span>Instruction digest</span>
                  <code>{short(proposal.instructionDigest)}</code>
                </div>
              </div>
              {canApprove && wallet && proposal.status === "PENDING" && (
                <button
                  className="button dark"
                  disabled={busy || approvedByCurrent}
                  onClick={() =>
                    void run(() =>
                      cofferApi.approveAgentPurchase(
                        organizationId,
                        purchase.id,
                        wallet,
                      ),
                    )
                  }
                >
                  {approvedByCurrent
                    ? "You approved this revision"
                    : `Approve as ${wallet}`}
                </button>
              )}
              {canPurchase && proposal.status === "APPROVED" && (
                <button
                  className="button dark"
                  disabled={busy || !workspace.executionEnabled}
                  onClick={() =>
                    void run(() =>
                      cofferApi.executeAgentPurchase(
                        organizationId,
                        purchase.id,
                      ),
                    )
                  }
                >
                  Complete controlled mock purchase
                </button>
              )}
            </>
          )}
          {purchase.mockPaymentReference && (
            <p className="automation-result">
              Mock payment · <code>{purchase.mockPaymentReference}</code>
              <br />
              Deliverable recorded; no external transfer occurred.
            </p>
          )}
        </section>
      )}
    </>
  );
}
