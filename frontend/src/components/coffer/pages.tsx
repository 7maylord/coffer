"use client";
import Link from "next/link";
import { useState, type ReactNode, type FormEvent } from "react";
import {
  initialDemo,
  money,
  parseMoney,
  splitAllocation,
  exportCsv,
  type PageId,
  type Invoice,
  type Approval,
  type Agent,
} from "@/lib/demo";
import { Icon, type IconName } from "./icon";
import { useDemo, Modal, Badge, WorkspaceLink } from "./workspace";
import { CashflowChart, AllocationRing } from "./charts";

function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  tone?: string;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div>
        <span>{label}</span>
        <Icon name={icon} size={17} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        ["Paid", "Reviewed", "Active"].includes(value)
          ? "success"
          : ["Overdue", "Rejected"].includes(value)
            ? "danger"
            : ["Awaiting payment", "Needs review"].includes(value)
              ? "warning"
              : "neutral"
      }
    >
      {value}
    </Badge>
  );
}
export function WorkspacePage({ page }: { page: PageId }) {
  switch (page) {
    case "overview":
      return <Overview />;
    case "treasury":
      return <Treasury />;
    case "invoices":
      return <Invoices />;
    case "approvals":
      return <Approvals />;
    case "cfo":
      return <Cfo />;
    case "agents":
      return <Agents />;
    case "payroll":
      return <Payroll />;
    case "activity":
      return <ActivityPage />;
    case "settings":
      return <Settings />;
  }
}
function Overview() {
  const { state } = useDemo();
  const pending = state.approvals.filter((a) => a.status === "Needs review");
  const outstanding = state.invoices
    .filter((i) => ["Awaiting payment", "Overdue"].includes(i.status))
    .reduce((sum, i) => sum + BigInt(i.amount), 0n);
  return (
    <>
      <Heading
        eyebrow="FRIDAY, OCTOBER 30 / DEMO SNAPSHOT"
        title={
          <>
            Good things ahead, <em>Jamie.</em>
          </>
        }
        description="Here’s where things stand. And where they could go."
      >
        <WorkspaceLink page="invoices" className="button dark">
          <Icon name="plus" size={17} />
          Create invoice
        </WorkspaceLink>
      </Heading>
      <div className="overview-hero">
        <section className="balance-card">
          <div className="balance-top">
            <span>
              <span className="live-dot" />
              YOUR STUDIO, AT A GLANCE
            </span>
            <Icon name="northeast" />
          </div>
          <span className="balance-label">Treasury balance</span>
          <div className="balance-amount">
            $64,280<span>.00</span>
          </div>
          <div className="balance-comparison">
            <span>↗ 12.8%</span> versus previous demo month
          </div>
          <div className="balance-bottom">
            <span>Illustrative USD · Internal ledger</span>
            <WorkspaceLink page="treasury">
              Open treasury <Icon name="arrow" size={17} />
            </WorkspaceLink>
          </div>
          <div className="balance-sculpture" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </section>
        <section className="insight-card">
          <span className="eyebrow">
            <Icon name="spark" size={15} /> A LITTLE FORESIGHT
          </span>
          <h2>
            Your next month,
            <br />
            <em>already considered.</em>
          </h2>
          <p>
            Your team allocation is ready for a second look. A little planning
            now, a little more peace of mind later.
          </p>
          <WorkspaceLink page="cfo" className="text-link">
            Explore your allocation <Icon name="arrow" size={18} />
          </WorkspaceLink>
          <span className="insight-flower" aria-hidden="true">
            ✳
          </span>
        </section>
      </div>
      <div className="stats-row">
        <Stat
          label="Incoming invoices"
          value={money(outstanding.toString())}
          detail="Awaiting simulated payment"
          icon="invoice"
        />
        <Stat
          label="Reserved for your team"
          value="$18,400.00"
          detail="November · illustrative allocation"
          icon="people"
        />
        <Stat
          label="Needs your attention"
          value={`${pending.length.toString().padStart(2, "0")} proposals`}
          detail="A human decision makes the difference"
          icon="shield"
        />
      </div>
      <div className="dashboard-grid">
        <CashflowChart />
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">A MOMENT OF YOUR TIME</span>
              <h2>
                Up for review{" "}
                <span className="count-circle">{pending.length}</span>
              </h2>
            </div>
            <WorkspaceLink page="approvals" aria-label="View all approvals">
              <Icon name="northeast" size={18} />
            </WorkspaceLink>
          </div>
          {pending.length ? (
            pending.slice(0, 3).map((item) => (
              <WorkspaceLink
                page="approvals"
                className="review-row"
                key={item.id}
              >
                <span
                  className={`icon-tile ${item.category === "Payroll" ? "peach" : "lilac"}`}
                >
                  <Icon
                    name={item.category === "Payroll" ? "people" : "treasury"}
                  />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.signers.length} of 2 demo reviews</small>
                </span>
                <Icon name="chevron" size={16} />
              </WorkspaceLink>
            ))
          ) : (
            <p className="empty-state">
              All caught up. A little room to breathe.
            </p>
          )}
          <div className="quiet-note">
            <Icon name="lock" size={14} /> Proposals never move money on their
            own.
          </div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">THE LATEST CHAPTER</span>
            <h2>Around the studio</h2>
          </div>
          <WorkspaceLink className="text-link" page="activity">
            All activity <Icon name="arrow" size={16} />
          </WorkspaceLink>
        </div>
        <div className="recent-activity">
          {state.activity.slice(0, 3).map((event, index) => (
            <div key={event.id}>
              <span
                className={`activity-icon ${index === 0 ? "sage" : index === 1 ? "peach" : "lilac"}`}
              >
                <Icon
                  name={
                    index === 0
                      ? "invoice"
                      : index === 1
                        ? "treasury"
                        : "agents"
                  }
                  size={18}
                />
              </span>
              <span>
                <strong>{event.title}</strong>
                <small>{event.detail}</small>
              </span>
              <time>{event.time}</time>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function InvoiceRows({
  invoices,
  select,
}: {
  invoices: Invoice[];
  select: (invoice: Invoice) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>INVOICE / CLIENT</th>
            <th>DESCRIPTION</th>
            <th>AMOUNT</th>
            <th>DUE DATE</th>
            <th>STATUS</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>
                <button className="client-cell" onClick={() => select(invoice)}>
                  <span className={`avatar ${invoice.color}`}>
                    {invoice.initials}
                  </span>
                  <span>
                    <strong>{invoice.client}</strong>
                    <small>{invoice.id}</small>
                  </span>
                </button>
              </td>
              <td>{invoice.description}</td>
              <td className="amount-cell">{money(invoice.amount)}</td>
              <td>
                {new Date(`${invoice.due}T12:00:00Z`).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", timeZone: "UTC" },
                )}
              </td>
              <td>
                <Status value={invoice.status} />
              </td>
              <td>
                <button
                  className="icon-button"
                  onClick={() => select(invoice)}
                  aria-label={`View ${invoice.id}`}
                >
                  <Icon name="northeast" size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!invoices.length && (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h3>No invoices here, yet.</h3>
          <p>Try another search or create your first demo invoice.</p>
        </div>
      )}
    </div>
  );
}
function Invoices() {
  const { state, setState, notify, record } = useDemo();
  const [filter, setFilter] = useState("All invoices");
  const [search, setSearch] = useState("");
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  const filtered = state.invoices.filter(
    (invoice) =>
      (filter === "All invoices" || invoice.status === filter) &&
      `${invoice.client} ${invoice.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sum = (statuses: string[]) =>
    money(
      state.invoices
        .filter((i) => statuses.includes(i.status))
        .reduce((n, i) => n + BigInt(i.amount), 0n)
        .toString(),
    );
  function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const client = String(data.get("client")).trim();
      const description = String(data.get("description")).trim();
      if (!client || !description)
        throw new Error("Add a demo client and description.");
      const amount = parseMoney(String(data.get("amount")));
      const due = String(data.get("due"));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)))
        throw new Error("Choose a valid due date.");
      const invoice: Invoice = {
        id: `INV-DEMO-${state.invoices.length + 1}`,
        client,
        initials: client.slice(0, 2).toUpperCase(),
        description,
        amount,
        due,
        status: "Draft",
        color: "lilac",
      };
      setState((previous) => ({
        ...previous,
        invoices: [invoice, ...previous.invoices],
      }));
      record(
        `${invoice.id} drafted`,
        `${client} · local demo only`,
        "Invoices",
      );
      setCreate(false);
      setFilter("All invoices");
      notify("Your demo invoice is drafted. No invoice was sent.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to create draft.",
      );
    }
  }
  return (
    <>
      <Heading
        eyebrow="GOOD WORK, RECOGNIZED"
        title={
          <>
            Make it <em>official.</em>
          </>
        }
        description="Thoughtful invoices. Clear expectations. One less loose end."
      >
        <button className="button" onClick={() => exportCsv(filtered)}>
          <Icon name="download" size={16} />
          Export
        </button>
        <button
          className="button dark"
          onClick={() => {
            setError("");
            setCreate(true);
          }}
        >
          <Icon name="plus" size={17} />
          Create invoice
        </button>
      </Heading>
      <div className="stats-row">
        <Stat
          label="Outstanding"
          value={sum(["Awaiting payment", "Overdue"])}
          detail="Across open demo invoices"
          icon="invoice"
        />
        <Stat
          label="Received"
          value={sum(["Paid"])}
          detail="Simulated reconciled receipts"
          icon="check"
        />
        <Stat
          label="In draft"
          value={sum(["Draft"])}
          detail="A good beginning"
          icon="clock"
        />
      </div>
      <section className="panel invoice-panel">
        <div className="table-toolbar">
          <div className="tabs" aria-label="Invoice status">
            {[
              "All invoices",
              "Awaiting payment",
              "Paid",
              "Draft",
              "Overdue",
            ].map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="inline-search">
            <Icon name="search" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find an invoice…"
              aria-label="Find an invoice"
            />
          </label>
        </div>
        <InvoiceRows invoices={filtered} select={setSelected} />
        <div className="table-footnote">
          {filtered.length} invoices{" "}
          <span>All amounts are illustrative USD. No live payments.</span>
        </div>
      </section>
      <div className="editorial-note">
        <span>↳</span>
        <p>
          Good work deserves a clear paper trail.
          <br />
          <strong>Start with the details. Let the rest follow.</strong>
        </p>
      </div>
      {create && (
        <Modal title="A new beginning." close={() => setCreate(false)}>
          <p className="modal-description">
            Create a local demo invoice. Use fictional information only.
          </p>
          <form onSubmit={createInvoice} className="form-stack">
            <label>
              Demo client
              <input
                name="client"
                required
                maxLength={60}
                placeholder="e.g. Acme Studio"
              />
            </label>
            <label>
              What is it for?
              <input
                name="description"
                required
                maxLength={140}
                placeholder="e.g. November design partnership"
              />
            </label>
            <div className="form-grid">
              <label>
                Amount · demo USD
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="2500.00"
                />
              </label>
              <label>
                Due date
                <input
                  name="due"
                  type="date"
                  required
                  defaultValue="2026-11-14"
                />
              </label>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setCreate(false)}
              >
                Cancel
              </button>
              <button className="button dark" type="submit">
                Create draft <Icon name="arrow" size={17} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title={selected.id} close={() => setSelected(null)}>
          <div className="invoice-paper">
            <div className="invoice-paper-top">
              <span className="brand">coffer.</span>
              <Status value={selected.status} />
            </div>
            <span className="eyebrow">PREPARED FOR</span>
            <h3>{selected.client}</h3>
            <p>{selected.description}</p>
            <div className="invoice-line">
              <span>Project fee</span>
              <strong>{money(selected.amount)}</strong>
            </div>
            <div className="invoice-total">
              <span>Total · demo USD</span>
              <strong>{money(selected.amount)}</strong>
            </div>
            <small>Due {selected.due} · Synthetic invoice</small>
          </div>
          <p className="quiet-note">
            <Icon name="lock" size={16} />
            Preview only. Issuing, sharing, and collecting payment require the
            backend connection.
          </p>
        </Modal>
      )}
    </>
  );
}
function Treasury() {
  const { notify, setState, record } = useDemo();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10000.00");
  const [error, setError] = useState("");
  let parts: string[] = ["0", "0", "0"];
  try {
    parts = splitAllocation(parseMoney(amount));
  } catch {
    /* Incomplete user input has no allocation. */
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const total = parseMoney(amount);
      if (BigInt(total) > 6428000n)
        throw new Error("The proposal exceeds the $64,280 demo treasury.");
      const id = crypto.randomUUID();
      setState((previous) => ({
        ...previous,
        approvals: [
          {
            id,
            title: "Studio revenue allocation",
            category: "Treasury",
            amount: total,
            status: "Needs review",
            signers: [],
          },
          ...previous.approvals,
        ],
      }));
      record(
        "Revenue allocation proposed",
        "50% team · 30% operations · 20% reserves",
        "Treasury",
      );
      setOpen(false);
      notify("Allocation sent to demo review. No funds reserved or moved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid allocation.");
    }
  }
  return (
    <>
      <Heading
        eyebrow="THE FOUNDATION FOR WHAT’S NEXT"
        title={
          <>
            Room to <em>grow.</em>
          </>
        }
        description="One clear picture of your resources. Every allocation, intentional."
      >
        <button
          className="button dark"
          onClick={() => {
            setOpen(true);
            setError("");
          }}
        >
          <Icon name="plus" size={17} />
          Propose allocation
        </button>
      </Heading>
      <div className="treasury-grid">
        <section className="panel treasury-summary">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">STUDIO TREASURY</span>
              <h2>Everything, in balance.</h2>
            </div>
            <Badge>Simulated</Badge>
          </div>
          <AllocationRing />
          <div className="allocation-legend">
            {[
              ["Payroll", "50%", "3214000"],
              ["Operations", "30%", "1928400"],
              ["Reserves", "20%", "1285600"],
            ].map(([label, percent, value], index) => (
              <div key={label}>
                <i className={`allocation-dot dot-${index}`} />
                <span>{label}</span>
                <small>{percent}</small>
                <strong>{money(value)}</strong>
              </div>
            ))}
          </div>
        </section>
        <div>
          <section className="treasury-philosophy">
            <span className="eyebrow">A SHARED DIRECTION</span>
            <h2>
              Yours to build.
              <br />
              <em>Ours to consider.</em>
            </h2>
            <p>
              A healthy treasury gives people room to do their best work. Plan
              together, approve together, move forward together.
            </p>
            <div className="avatar-stack">
              <span className="avatar peach">JD</span>
              <span className="avatar sage">AK</span>
              <span className="avatar lilac">ML</span>
              <span>3 demo co-owners</span>
            </div>
          </section>
          <section className="panel treasury-policy">
            <Icon name="shield" size={28} />
            <h3>Two perspectives. One decision.</h3>
            <p>
              Every allocation requires two distinct human approvals. A proposal
              is a plan, never a payment.
            </p>
            <WorkspaceLink className="text-link" page="approvals">
              See pending proposals <Icon name="arrow" size={17} />
            </WorkspaceLink>
          </section>
        </div>
      </div>
      <div className="asset-strip">
        <div>
          <span className="token-icon">N</span>
          <div>
            <strong>NEAR testnet</strong>
            <small>Wallet not connected</small>
          </div>
          <Badge>Not verified</Badge>
        </div>
        <div>
          <span className="token-icon mock">¢</span>
          <div>
            <strong>ctUSD</strong>
            <small>Test token · deployment pending</small>
          </div>
          <Badge>Unavailable</Badge>
        </div>
        <p>
          Illustrative USD allocations above are separate from on-chain
          balances.
        </p>
      </div>
      {open && (
        <Modal
          title="Give every dollar a purpose."
          close={() => setOpen(false)}
        >
          <form className="form-stack" onSubmit={submit}>
            <p className="modal-description">
              Preview a 50 / 30 / 20 split. Exact cents, with any remainder
              assigned to reserves.
            </p>
            <label>
              Total allocation · demo USD
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <div className="allocation-preview">
              {["Your people", "Studio operations", "Room for tomorrow"].map(
                (label, index) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{money(parts[index])}</strong>
                  </div>
                ),
              )}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button dark" type="submit">
              Create demo proposal <Icon name="arrow" size={17} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Approvals() {
  const { state, setState, notify, record } = useDemo();
  const [selected, setSelected] = useState<Approval | null>(null);
  const [filter, setFilter] = useState("Needs review");
  function decide(reject: boolean) {
    if (!selected) return;
    const id = selected.id;
    setState((previous) => ({
      ...previous,
      approvals: previous.approvals.map((a) =>
        a.id === id && a.status === "Needs review"
          ? {
              ...a,
              status: reject ? "Rejected" : "Reviewed",
              signers: reject ? a.signers : [...a.signers, "You (demo)"],
            }
          : a,
      ),
    }));
    record(
      `${selected.title} ${reject ? "rejected" : "reviewed"}`,
      "Local walkthrough decision · not a wallet signature",
      "Policy",
    );
    setSelected(null);
    notify(
      reject
        ? "Demo proposal rejected."
        : "Demo review recorded. No signature or payment was submitted.",
    );
  }
  return (
    <>
      <Heading
        eyebrow="A HUMAN MOMENT"
        title={
          <>
            Good decisions,
            <br />
            <em>made together.</em>
          </>
        }
        description="Take a closer look before the next step. Your perspective matters."
      />
      <div className="approval-banner">
        <span className="shield-seal">
          <Icon name="shield" size={30} />
        </span>
        <div>
          <strong>Your judgment is the final layer.</strong>
          <p>Agents can suggest. Only authorized people can approve.</p>
        </div>
        <Badge tone="success">Human by design</Badge>
      </div>
      <div className="tabs standalone">
        {["Needs review", "Reviewed", "Rejected", "All"].map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={filter === value ? "active" : ""}
            aria-pressed={filter === value}
          >
            {value}
            {value === "Needs review" && (
              <span>
                {state.approvals.filter((a) => a.status === value).length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="proposal-grid">
        {state.approvals
          .filter((a) => filter === "All" || a.status === filter)
          .map((item) => (
            <article className="proposal-card" key={item.id}>
              <div className="proposal-top">
                <span className="eyebrow">{item.category}</span>
                <Status value={item.status} />
              </div>
              <h2>{item.title}</h2>
              <div className="proposal-amount">
                {money(item.amount)}
                <span>demo USD</span>
              </div>
              <div className="proposal-checks">
                <span>
                  <Icon name="check" size={15} /> Within illustrative budget
                </span>
                <span>
                  <Icon name="check" size={15} /> Human review required
                </span>
              </div>
              <div className="proposal-bottom">
                <span className="review-count">
                  <span className="avatar lilac">
                    {item.signers.length > 0 ? "AK" : "—"}
                  </span>
                  {item.signers.length} of 2 demo reviews
                </span>
                <button
                  className="button small"
                  onClick={() => setSelected(item)}
                >
                  View proposal <Icon name="arrow" size={16} />
                </button>
              </div>
            </article>
          ))}
      </div>
      {!state.approvals.some(
        (a) => filter === "All" || a.status === filter,
      ) && (
        <div className="empty-state panel">
          <Icon name="check" size={34} />
          <h2>All clear here.</h2>
          <p>No proposals in this view.</p>
        </div>
      )}
      {selected && (
        <Modal title={selected.title} close={() => setSelected(null)}>
          <div className="review-amount">
            {money(selected.amount)}
            <small>Illustrative USD allocation</small>
          </div>
          <div className="allocation-preview">
            <div>
              <span>Purpose</span>
              <strong>{selected.category}</strong>
            </div>
            <div>
              <span>Current reviews</span>
              <strong>{selected.signers.length} / 2 demo people</strong>
            </div>
            <div>
              <span>Execution</span>
              <strong>Disabled</strong>
            </div>
          </div>
          <p className="modal-description">
            This demonstrates a review decision only. A real approval must bind
            the exact proposal to an authenticated signer and be verified by the
            backend.
          </p>
          {selected.status === "Needs review" && (
            <div className="modal-actions">
              <button className="button" onClick={() => decide(true)}>
                Reject proposal
              </button>
              <button className="button dark" onClick={() => decide(false)}>
                Record demo review <Icon name="check" size={17} />
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function Cfo() {
  const { notify, state, setState, record } = useDemo();
  const [generated, setGenerated] = useState(false);
  const [total, setTotal] = useState("10000.00");
  const [allocation, setAllocation] = useState(["500000", "300000", "200000"]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  function generate(event: FormEvent) {
    event.preventDefault();
    try {
      const cents = parseMoney(total);
      if (BigInt(cents) > 6428000n)
        throw new Error("Stay within the $64,280 demo treasury.");
      setAllocation(splitAllocation(cents));
      setGenerated(true);
      setSent(false);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid budget.");
    }
  }
  function send() {
    if (sent) return;
    const amount = allocation.reduce((n, v) => n + BigInt(v), 0n).toString();
    setState((previous) => ({
      ...previous,
      approvals: [
        {
          id: crypto.randomUUID(),
          title: "Sage’s studio allocation",
          category: "CFO proposal",
          amount,
          status: "Needs review",
          signers: [],
        },
        ...previous.approvals,
      ],
    }));
    record(
      "CFO allocation sent for review",
      "Deterministic demo · no model request",
      "Treasury",
    );
    setSent(true);
    notify("Sage’s demo proposal is ready in Approvals.");
  }
  return (
    <>
      <Heading
        eyebrow="A THOUGHTFUL SECOND OPINION"
        title={
          <>
            Meet your
            <br />
            <em>thinking partner.</em>
          </>
        }
        description="A little clarity for the decisions that deserve it."
      />
      <div className="cfo-layout">
        <section className="cfo-intro">
          <div className="sage-orb" aria-hidden="true">
            <i />
            <i />
            <i />
            <Icon name="spark" size={46} />
          </div>
          <span className="eyebrow">SAGE / YOUR CFO COMPANION</span>
          <h2>
            Big picture.
            <br />
            Thoughtful details.
          </h2>
          <p>
            I can help you think through your next allocation. You set the
            boundaries; every decision stays yours.
          </p>
          <div className="capability">
            <Icon name="lock" size={15} /> Suggests only. Cannot move money.
          </div>
          <Badge>Deterministic demo · No live AI</Badge>
        </section>
        <section className="panel cfo-workbench">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LET’S MAKE A LITTLE ROOM</span>
              <h2>Plan your next allocation</h2>
            </div>
            <Icon name="spark" size={24} />
          </div>
          <form onSubmit={generate} className="form-stack">
            <label>
              How much would you like to set aside?
              <div className="amount-input">
                <span>$</span>
                <input
                  value={total}
                  onChange={(event) => setTotal(event.target.value)}
                  inputMode="decimal"
                  aria-label="Allocation budget"
                  required
                />
                <span>DEMO USD</span>
              </div>
            </label>
            <div className="context-box">
              <span className="eyebrow">WORKING WITH</span>
              <span>
                <Icon name="invoice" size={16} />
                {state.invoices.length} synthetic invoices
              </span>
              <span>
                <Icon name="treasury" size={16} />
                $64,280 illustrative treasury
              </span>
              <span>
                <Icon name="shield" size={16} />
                50 / 30 / 20 allocation rule
              </span>
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="button dark" type="submit">
              <Icon name="spark" size={17} />
              {generated ? "Reconsider allocation" : "Explore an allocation"}
            </button>
          </form>
          {generated && (
            <div className="cfo-result" aria-live="polite">
              <span className="eyebrow">A POSSIBLE WAY FORWARD</span>
              {[
                "Invest in your people",
                "Keep the studio moving",
                "Leave room for tomorrow",
              ].map((label, index) => (
                <div className="recommendation" key={label}>
                  <span className={`allocation-dot dot-${index}`} />
                  <div>
                    <h3>{label}</h3>
                    <p>
                      {
                        [
                          "50% · Team allocation",
                          "30% · Operating expenses",
                          "20% · Studio reserves",
                        ][index]
                      }
                    </p>
                  </div>
                  <strong>{money(allocation[index])}</strong>
                </div>
              ))}
              <p className="fine-print">
                A fixed-rule illustration, not financial advice or verified
                private inference. No provider has received this data.
              </p>
              <button className="button dark" disabled={sent} onClick={send}>
                {sent ? "Sent to demo review" : "Send to human review"}
                <Icon name={sent ? "check" : "arrow"} size={17} />
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Agents() {
  const { state, setState, notify, record } = useDemo();
  const [selected, setSelected] = useState<Agent | null>(null);
  const [offer, setOffer] = useState(false);
  function toggle(agent: Agent) {
    setState((previous) => ({
      ...previous,
      agents: previous.agents.map((a) =>
        a.id === agent.id ? { ...a, active: !a.active } : a,
      ),
    }));
    record(
      `${agent.name} ${agent.active ? "paused" : "resumed"}`,
      "Demo agent control · no external execution",
      "Agents",
    );
    notify(
      `${agent.name} is ${agent.active ? "paused" : "active"} in this demo.`,
    );
  }
  function requestOffer() {
    if (!selected?.active) return;
    setOffer(true);
  }
  return (
    <>
      <Heading
        eyebrow="SMALL TASKS. BIGGER POSSIBILITIES."
        title={
          <>
            A little help,
            <br />
            <em>on your terms.</em>
          </>
        }
        description="Your studio’s supporting cast. Clear roles, thoughtful boundaries."
      />
      <div className="agent-intro-strip">
        <div>
          <Icon name="shield" size={19} />
          <strong>Autonomy with boundaries</strong>
        </div>
        <span>Allowlisted services</span>
        <span>Explicit budgets</span>
        <span>Human approvals</span>
        <Badge>Mock services</Badge>
      </div>
      <div className="agent-grid">
        {state.agents.map((agent, index) => (
          <article className="agent-card" key={agent.id}>
            <div className="agent-top">
              <Status value={agent.active ? "Active" : "Paused"} />
              <span className="eyebrow">0{index + 1}</span>
            </div>
            <div className={`agent-avatar ${agent.color}`}>
              <div className={`agent-face face-${index}`}>
                <i />
                <i />
                <span />
              </div>
              <span className="agent-orbit" />
            </div>
            <h2>
              {agent.name}
              <span>↗</span>
            </h2>
            <p>{agent.role}</p>
            <div className="agent-budget">
              <span>
                Demo spend{" "}
                <strong>
                  {money(agent.spent)} <small>/ {money(agent.budget)}</small>
                </strong>
              </span>
              <div className="progress-track">
                <i
                  style={{
                    width:
                      agent.budget === "0"
                        ? "0%"
                        : `${Number((BigInt(agent.spent) * 100n) / BigInt(agent.budget))}%`,
                  }}
                />
              </div>
              <small>
                {agent.budget === "0"
                  ? "Read-only · no spending authority"
                  : "Monthly budget · illustrative USD"}
              </small>
            </div>
            <div className="agent-card-footer">
              <button
                className="text-link"
                onClick={() => {
                  setSelected(agent);
                  setOffer(false);
                }}
              >
                View agent <Icon name="arrow" size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => toggle(agent)}
                aria-label={`${agent.active ? "Pause" : "Resume"} ${agent.name}`}
              >
                <Icon name={agent.active ? "pause" : "play"} size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="agent-principle">
        <span className="asterisk">✳</span>
        <h2>
          More time for the work
          <br />
          <em>only you can do.</em>
        </h2>
        <p>
          Agents have a job to do, and a line they cannot cross.
          <br />
          Budgets, services, and approval rules define that line.
        </p>
      </div>
      {selected && (
        <Modal title={`Meet ${selected.name}.`} close={() => setSelected(null)}>
          <p className="modal-description">
            {selected.role}. This demonstration agent never contacts an external
            service.
          </p>
          <div className="allocation-preview">
            <div>
              <span>State</span>
              <strong>{selected.active ? "Active" : "Paused"}</strong>
            </div>
            <div>
              <span>Budget remaining</span>
              <strong>
                {money(
                  (BigInt(selected.budget) - BigInt(selected.spent)).toString(),
                )}
              </strong>
            </div>
            <div>
              <span>Permitted service</span>
              <strong>
                {selected.id === "agent-01"
                  ? "Mock document classifier"
                  : "Local suggestions only"}
              </strong>
            </div>
            <div>
              <span>Signing authority</span>
              <strong>None</strong>
            </div>
          </div>
          {selected.id === "agent-01" && (
            <>
              <button
                className="button dark"
                disabled={!selected.active || offer}
                onClick={requestOffer}
              >
                {offer ? "Demo offer prepared" : "Preview a service offer"}
                <Icon name="arrow" size={17} />
              </button>
              {offer && (
                <div className="offer-preview">
                  <Badge>Mock offer</Badge>
                  <h3>Classify 10 synthetic documents</h3>
                  <strong>
                    $1.00 <small>demo USD</small>
                  </strong>
                  <p>
                    Vendor: mock-document-classifier
                    <br />
                    Purchase and fulfillment are not connected in this frontend.
                  </p>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
const employees = [
  {
    code: "DEMO-001",
    role: "Design",
    amount: "420000",
    initials: "01",
    color: "peach",
  },
  {
    code: "DEMO-002",
    role: "Engineering",
    amount: "480000",
    initials: "02",
    color: "lilac",
  },
  {
    code: "DEMO-003",
    role: "Strategy",
    amount: "320000",
    initials: "03",
    color: "sage",
  },
  {
    code: "DEMO-004",
    role: "Operations",
    amount: "240000",
    initials: "04",
    color: "yellow",
  },
  {
    code: "DEMO-005",
    role: "Design",
    amount: "280000",
    initials: "05",
    color: "blue",
  },
  {
    code: "DEMO-006",
    role: "Community",
    amount: "120000",
    initials: "06",
    color: "peach",
  },
];
function Payroll() {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<(typeof employees)[number] | null>(
    null,
  );
  const [batch, setBatch] = useState(false);
  return (
    <>
      <Heading
        eyebrow="THE PEOPLE BEHIND THE POSSIBILITY"
        title={
          <>
            People first.
            <br />
            <em>Always.</em>
          </>
        }
        description="A considered space for your team’s payroll."
      >
        <button className="button dark" onClick={() => setBatch(true)}>
          Review demo batch <Icon name="arrow" size={17} />
        </button>
      </Heading>
      <div className="payroll-hero">
        <div>
          <span className="eyebrow">NOVEMBER 2026 / DEMO BATCH</span>
          <h2>
            A good month
            <br />
            starts with <em>your people.</em>
          </h2>
          <div className="payroll-summary">
            <div>
              <span>Team allocation</span>
              <strong>
                $18,400<span>.00</span>
              </strong>
            </div>
            <div>
              <span>Demo employees</span>
              <strong>06</strong>
            </div>
          </div>
        </div>
        <div className="people-sculpture" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="privacy-notice">
        <Icon name="lock" size={19} />
        <p>
          <strong>Synthetic records only.</strong> Hiding demo amounts is a
          display preference, not encryption. Real payroll requires
          authenticated, audited access.
        </p>
        <button className="text-link" onClick={() => setVisible(!visible)}>
          <Icon name="eye" size={16} />
          {visible ? "Hide amounts" : "Show demo amounts"}
        </button>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR DEMO TEAM</span>
            <h2>Every person counts.</h2>
          </div>
          <Badge>Draft · no payouts</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>TEAM</th>
                <th>GROSS / NET</th>
                <th>STATUS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.code}>
                  <td>
                    <div className="client-cell">
                      <span className={`avatar ${employee.color}`}>
                        {employee.initials}
                      </span>
                      <span>
                        <strong>{employee.code}</strong>
                        <small>Synthetic employee</small>
                      </span>
                    </div>
                  </td>
                  <td>{employee.role}</td>
                  <td className="amount-cell">
                    {visible ? money(employee.amount) : "••••••"}
                  </td>
                  <td>
                    <Badge>Prepared</Badge>
                  </td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => setSelected(employee)}
                    >
                      Preview <Icon name="northeast" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="quiet-note">
        <Icon name="shield" size={16} />
        Private AI verification unavailable. No inference or payout has been
        requested.
      </div>
      {selected && (
        <Modal title="A little clarity." close={() => setSelected(null)}>
          <div className="payslip-paper">
            <span className="eyebrow">SYNTHETIC PAYSLIP / NOVEMBER 2026</span>
            <h3>{selected.code}</h3>
            <p>{selected.role} · Demo team</p>
            <div className="allocation-preview">
              <div>
                <span>Gross allocation</span>
                <strong>{money(selected.amount)}</strong>
              </div>
              <div>
                <span>Deductions</span>
                <strong>$0.00</strong>
              </div>
              <div>
                <span>Net allocation</span>
                <strong>{money(selected.amount)}</strong>
              </div>
            </div>
            <p className="fine-print">
              Synthetic no-tax illustration. Not a real payslip or proof of
              payment. This demo does not implement employee authentication.
            </p>
          </div>
        </Modal>
      )}
      {batch && (
        <Modal title="November, considered." close={() => setBatch(false)}>
          <div className="review-amount">
            $18,400.00<small>Six synthetic records · no-tax assumption</small>
          </div>
          <div className="allocation-preview">
            <div>
              <span>Amount consistency</span>
              <strong>Gross equals net</strong>
            </div>
            <div>
              <span>Private AI</span>
              <strong>Unavailable</strong>
            </div>
            <div>
              <span>Backend import</span>
              <strong>Not connected</strong>
            </div>
            <div>
              <span>Payout execution</span>
              <strong>Disabled</strong>
            </div>
          </div>
          <p className="modal-description">
            This page is a design preview of the finance workflow. Real CSV
            import, encrypted records, manifest approvals, and self-only
            payslips remain integration work.
          </p>
        </Modal>
      )}
    </>
  );
}
function ActivityPage() {
  const { state } = useDemo();
  const [filter, setFilter] = useState("Everything");
  const [query, setQuery] = useState("");
  const events = state.activity.filter(
    (event) =>
      (filter === "Everything" || event.category === filter) &&
      `${event.title} ${event.detail}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="NOTHING LOST BETWEEN THE LINES"
        title={
          <>
            The story,
            <br />
            <em>as it happens.</em>
          </>
        }
        description="Every decision has a chapter. Here’s your studio’s."
      />
      <div className="activity-layout">
        <section className="panel timeline-panel">
          <div className="table-toolbar">
            <div className="tabs">
              {[
                "Everything",
                "Invoices",
                "Treasury",
                "Agents",
                "Policy",
                "Payroll",
              ].map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <label className="inline-search activity-search">
            <Icon name="search" size={17} />
            <input
              aria-label="Search activity"
              placeholder="Look for a moment…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="timeline">
            <span className="eyebrow">DEMO SESSION</span>
            {events.map((event) => (
              <article key={event.id} className="timeline-event">
                <span
                  className={`timeline-marker ${event.category === "Policy" ? "warning" : ""}`}
                >
                  <Icon
                    name={event.category === "Policy" ? "shield" : "check"}
                    size={15}
                  />
                </span>
                <time>{event.time}</time>
                <h3>{event.title}</h3>
                <p>{event.detail}</p>
                <span className="event-category">{event.category}</span>
              </article>
            ))}
            {!events.length && (
              <div className="empty-state">
                <h3>No matching moments.</h3>
                <p>Try a different category or search.</p>
              </div>
            )}
          </div>
        </section>
        <aside className="activity-aside">
          <Icon name="activity" size={42} />
          <h2>
            A trail worth
            <br />
            <em>following.</em>
          </h2>
          <p>
            This local activity feed helps you explore how Coffer feels.
            Refreshing the browser resets your session.
          </p>
          <div>
            <Icon name="lock" size={17} />
            <span>
              Backend audit integration pending. This feed is not immutable
              evidence.
            </span>
          </div>
          <WorkspaceLink className="text-link" page="settings">
            Demo details <Icon name="arrow" size={16} />
          </WorkspaceLink>
        </aside>
      </div>
    </>
  );
}
function Settings() {
  const { state, setState, notify } = useDemo();
  const [name, setName] = useState(state.workspace);
  const [reset, setReset] = useState(false);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setState((previous) => ({ ...previous, workspace: name.trim() }));
    notify("Workspace name updated for this demo session.");
  }
  return (
    <>
      <Heading
        eyebrow="MAKE YOURSELF AT HOME"
        title={
          <>
            The little <em>details.</em>
          </>
        }
        description="A workspace that feels a little more like you."
      />
      <div className="settings-layout">
        <div className="settings-sections">
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">YOUR CORNER OF COFFER</span>
                <h2>Workspace</h2>
              </div>
              <span className="studio-avatar large">f.</span>
            </div>
            <form className="form-stack" onSubmit={save}>
              <label>
                Demo workspace name
                <input
                  value={name}
                  maxLength={40}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="setting-readonly">
                <span>Workspace type</span>
                <Badge>Local demonstration</Badge>
              </div>
              <div className="setting-readonly">
                <span>Your role</span>
                <strong>Demo owner · not authenticated</strong>
              </div>
              <button className="button dark" type="submit">
                Save changes <Icon name="check" size={17} />
              </button>
            </form>
          </section>
          <section className="panel settings-panel">
            <span className="eyebrow">AT YOUR PACE</span>
            <h2>Motion & comfort</h2>
            <div className="setting-toggle">
              <div>
                <strong>Keep things still</strong>
                <p>Reduce decorative animation and movement.</p>
              </div>
              <button
                className={`switch ${state.reducedMotion ? "on" : ""}`}
                role="switch"
                aria-checked={state.reducedMotion}
                aria-label="Reduce motion"
                onClick={() =>
                  setState((previous) => ({
                    ...previous,
                    reducedMotion: !previous.reducedMotion,
                  }))
                }
              >
                <span />
              </button>
            </div>
            <p className="fine-print">
              Your device’s reduced-motion preference is always respected.
            </p>
          </section>
          <section className="panel settings-panel">
            <span className="eyebrow">A FRESH START</span>
            <h2>Reset the demo</h2>
            <p>
              Restore the fictional studio, invoices, agents, and proposals.
              This only resets your current browser session.
            </p>
            <button className="button" onClick={() => setReset(true)}>
              Start fresh <Icon name="arrow" size={17} />
            </button>
          </section>
        </div>
        <aside className="settings-aside">
          <span className="asterisk">✳</span>
          <h2>
            A little context.
            <br />
            <em>Full transparency.</em>
          </h2>
          <p>
            You’re exploring a frontend demonstration of Coffer. Everything here
            is synthetic and stored only in memory.
          </p>
          <ul>
            <li>No wallet is connected.</li>
            <li>No funds are held or transferred.</li>
            <li>No live AI or external service is called.</li>
            <li>Reviews are local simulations.</li>
            <li>The authenticated shell uses verified NEAR wallet sessions.</li>
          </ul>
          <Link href="/" className="text-link">
            Back to the beginning <Icon name="arrow" size={17} />
          </Link>
        </aside>
      </div>
      {reset && (
        <Modal title="A fresh beginning?" close={() => setReset(false)}>
          <p className="modal-description">
            This clears your local demo changes and restores Forma Studio’s
            sample data.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setReset(false)}>
              Keep exploring
            </button>
            <button
              className="button dark"
              onClick={() => {
                setState(initialDemo());
                setName("Forma Studio");
                setReset(false);
                notify("A fresh studio. A little more possibility.");
              }}
            >
              Reset demo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
