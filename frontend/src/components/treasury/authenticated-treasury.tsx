"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";
import { Modal } from "@/components/coffer/workspace";
import {
  ApiError,
  cofferApi,
  type TreasuryProposal,
  type TreasuryWorkspace,
} from "@/lib/coffer-api";
import { formatAtomic, parseAtomic } from "@/lib/atomic";
import {
  canApproveTreasuryProposal,
  canCreateTreasuryProposal,
  canManageTreasuryPolicy,
  canReserveTreasuryProposal,
} from "@/lib/workspace-access";

const DECIMALS = 6;

type View = "treasury" | "approvals";
type Editor = "create" | "revise" | "policy" | null;
type ReserveEvidence = Awaited<
  ReturnType<typeof cofferApi.reserveTreasurySplit>
>;

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CONFLICT")
      return "The revision changed, expired, lacks funds, or already has this approval.";
    if (error.code === "FORBIDDEN")
      return "The active policy or your role denied this action.";
    if (error.code === "UNAVAILABLE")
      return "Final policy evidence could not be verified. No funds were reserved.";
    if (error.code === "INVALID_RESPONSE")
      return "Coffer rejected an unverifiable API response.";
  }
  if (error instanceof Error) return error.message;
  return "The request could not be completed.";
}

function isoInput(days = 7): string {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

function split(amountAtomic: string) {
  const amount = BigInt(amountAtomic);
  const payrollBase = (amount * 5_000n) / 10_000n;
  const operations = (amount * 3_000n) / 10_000n;
  const partners = (amount * 2_000n) / 10_000n;
  return [
    {
      label: "Payroll",
      bps: 5_000,
      amountAtomic: (
        payrollBase +
        amount -
        payrollBase -
        operations -
        partners
      ).toString(),
    },
    { label: "Operations", bps: 3_000, amountAtomic: operations.toString() },
    {
      label: "Partner distributions",
      bps: 2_000,
      amountAtomic: partners.toString(),
    },
  ];
}

function shortDigest(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function previewAtomic(value: string): string | null {
  try {
    const atomic = parseAtomic(value, DECIMALS);
    return BigInt(atomic) > 0n ? atomic : null;
  } catch {
    return null;
  }
}

function effectiveStatus(
  proposal: TreasuryProposal,
): TreasuryProposal["status"] {
  if (
    (proposal.status === "PENDING" || proposal.status === "APPROVED") &&
    Date.parse(proposal.expiresAt) <= Date.now()
  )
    return "EXPIRED";
  return proposal.status;
}

function Status({ proposal }: { proposal: TreasuryProposal }) {
  const status = effectiveStatus(proposal);
  return (
    <span className={`api-status is-${status.toLowerCase()}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function SplitBars({ amountAtomic }: { amountAtomic: string }) {
  return (
    <div className="treasury-split-bars">
      {split(amountAtomic).map((allocation) => (
        <div
          key={allocation.label}
          style={{ "--share": `${allocation.bps / 100}%` } as CSSProperties}
        >
          <span>
            <strong>{allocation.label}</strong>
            <small>{allocation.bps / 100}%</small>
          </span>
          <b>{formatAtomic(allocation.amountAtomic, DECIMALS)}</b>
        </div>
      ))}
      <small>
        Integer arithmetic · any atomic-unit remainder goes to Payroll
      </small>
    </div>
  );
}

export function AuthenticatedTreasury() {
  return <TreasuryJourney view="treasury" />;
}

export function AuthenticatedApprovals() {
  return <TreasuryJourney view="approvals" />;
}

function TreasuryJourney({ view }: { view: View }) {
  const { currentOrganization, session } = useAuth();
  const [workspace, setWorkspace] = useState<TreasuryWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [amount, setAmount] = useState("10000");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [expiresAt, setExpiresAt] = useState(isoInput());
  const [policyCap, setPolicyCap] = useState("10000");
  const [policyRollingCap, setPolicyRollingCap] = useState("50000");
  const [policyExpiresAt, setPolicyExpiresAt] = useState(isoInput(30));
  const [evidence, setEvidence] = useState<Record<string, ReserveEvidence>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const organizationId = currentOrganization?.id;
  const role = currentOrganization?.role;

  const load = async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const next = await cofferApi.treasuryWorkspace(organizationId);
      setWorkspace(next);
      setSourceAccountId((current) =>
        next.accounts.some((account) => account.id === current)
          ? current
          : (next.accounts.find((account) => account.accountType === "ASSET")
              ?.id ?? ""),
      );
      setSelectedId((current) =>
        next.proposals.some((proposal) => proposal.id === current)
          ? current
          : (next.proposals.find((proposal) => proposal.status !== "SUPERSEDED")
              ?.id ??
            next.proposals[0]?.id ??
            null),
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
      .treasuryWorkspace(organizationId)
      .then((next) => {
        if (!active) return;
        setWorkspace(next);
        setSourceAccountId(
          next.accounts.find((account) => account.accountType === "ASSET")
            ?.id ?? "",
        );
        setSelectedId(
          next.proposals.find((proposal) => proposal.status !== "SUPERSEDED")
            ?.id ??
            next.proposals[0]?.id ??
            null,
        );
      })
      .catch((cause) => active && setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [organizationId]);

  const selected =
    workspace?.proposals.find((proposal) => proposal.id === selectedId) ?? null;
  const previous = selected
    ? workspace?.proposals.find(
        (proposal) =>
          proposal.proposalKey === selected.proposalKey &&
          proposal.revision === selected.revision - 1,
      )
    : undefined;
  const totals = useMemo(() => {
    const accounts = workspace?.accounts ?? [];
    return accounts
      .filter((account) => account.accountType === "ASSET")
      .reduce(
        (result, account) => ({
          posted: result.posted + BigInt(account.postedBalanceAtomic),
          reserved: result.reserved + BigInt(account.reservedBalanceAtomic),
          available: result.available + BigInt(account.availableBalanceAtomic),
        }),
        { posted: 0n, reserved: 0n, available: 0n },
      );
  }, [workspace]);

  const updateProposal = (proposal: TreasuryProposal) => {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            proposals: [
              proposal,
              ...current.proposals.filter((item) => item.id !== proposal.id),
            ],
          }
        : current,
    );
    setSelectedId(proposal.id);
  };

  const submitSplit = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !sourceAccountId) return;
    setBusy(true);
    setError("");
    try {
      const input = {
        sourceAccountId,
        amountAtomic: parseAtomic(amount, DECIMALS),
        expiresAt: new Date(expiresAt).toISOString(),
      };
      const proposal =
        editor === "revise" && selected
          ? await cofferApi.reviseTreasurySplit(
              organizationId,
              selected.id,
              input,
            )
          : await cofferApi.createTreasurySplit(organizationId, input);
      setEditor(null);
      await load();
      setSelectedId(proposal.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitPolicy = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      await cofferApi.activateTreasuryPolicy(organizationId, {
        perTransactionCapAtomic: parseAtomic(policyCap, DECIMALS),
        rollingWindowCapAtomic: parseAtomic(policyRollingCap, DECIMALS),
        expiresAt: new Date(policyExpiresAt).toISOString(),
      });
      setEditor(null);
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (operation: () => Promise<TreasuryProposal>) => {
    setBusy(true);
    setError("");
    try {
      updateProposal(await operation());
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const reserve = async () => {
    if (!organizationId || !selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await cofferApi.reserveTreasurySplit(
        organizationId,
        selected.id,
      );
      setEvidence((current) => ({ ...current, [selected.id]: result }));
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const currentEvidence = selected ? evidence[selected.id] : undefined;
  const currentWallet = session?.wallets.find(
    (wallet) => wallet.network === "testnet",
  );
  const alreadyApproved = Boolean(
    selected?.approvals.some(
      (approval) => approval.approverUserId === session?.userId,
    ),
  );

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">
            {view === "treasury"
              ? "TREASURY · INTERNAL LEDGER"
              : "POLICY SHIELD · 2-OF-N"}
          </span>
          <h1>
            {view === "treasury" ? (
              <>
                Every unit, <em>accounted.</em>
              </>
            ) : (
              <>
                Approve the <em>exact revision.</em>
              </>
            )}
          </h1>
          <p>
            {view === "treasury"
              ? "Exact balances and reservations, with custody claims kept honest."
              : "Two eligible people, one immutable digest, and a fresh execution check."}
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
          {view === "treasury" && role && canCreateTreasuryProposal(role) && (
            <button
              className="button dark"
              onClick={() => {
                setAmount("10000");
                setExpiresAt(isoInput());
                setEditor("create");
              }}
              disabled={
                !workspace?.activePolicy || workspace.accounts.length === 0
              }
            >
              <Icon name="plus" size={16} /> Propose split
            </button>
          )}
        </div>
      </header>

      {error && !editor && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      {view === "treasury" ? (
        <>
          <section className="treasury-truth-strip">
            <div>
              <span>Posted</span>
              <strong>
                {formatAtomic(totals.posted.toString(), DECIMALS)}
              </strong>
              <small>Mock USDC · ledger-derived internal</small>
            </div>
            <div>
              <span>Reserved</span>
              <strong>
                {formatAtomic(totals.reserved.toString(), DECIMALS)}
              </strong>
              <small>Held for approved obligations</small>
            </div>
            <div>
              <span>Available</span>
              <strong>
                {formatAtomic(totals.available.toString(), DECIMALS)}
              </strong>
              <small>Posted less active reservations</small>
            </div>
            <div className="custody-truth">
              <span>Custody evidence</span>
              <strong>Not verified on-chain</strong>
              <small>Internal mock ledger · no wallet balance claim</small>
            </div>
          </section>

          <div className="treasury-layout">
            <section className="panel api-invoice-panel" aria-busy={loading}>
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">TENANT-SCOPED ACCOUNTS</span>
                  <h2>Balance book</h2>
                </div>
                <span className="api-mode">MOCK ASSET</span>
              </div>
              {loading ? (
                <p className="api-empty">
                  Reading authoritative ledger balances…
                </p>
              ) : workspace?.accounts.length ? (
                <div className="treasury-account-list">
                  {workspace.accounts.map((account) => (
                    <article key={account.id}>
                      <div>
                        <strong>{account.name}</strong>
                        <small>
                          {account.code} · {account.accountType}
                        </small>
                      </div>
                      <div>
                        <span>Available</span>
                        <strong>
                          {formatAtomic(
                            account.availableBalanceAtomic,
                            DECIMALS,
                          )}
                        </strong>
                      </div>
                      <small>v{account.version}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="api-empty">
                  No Mock USDC ledger account exists yet. Reconciled mock
                  revenue creates authoritative accounts; the UI will not invent
                  a balance.
                </p>
              )}
            </section>

            <aside className="panel treasury-policy-card">
              <span className="eyebrow">ACTIVE POLICY</span>
              {workspace?.activePolicy ? (
                <>
                  <strong>2 distinct approvers</strong>
                  <p>
                    Every treasury split requires quorum. A new policy version
                    makes open approvals stale.
                  </p>
                  <dl>
                    <div>
                      <dt>Version</dt>
                      <dd>{workspace.activePolicy.version}</dd>
                    </div>
                    <div>
                      <dt>Digest</dt>
                      <dd title={workspace.activePolicy.digest}>
                        {shortDigest(workspace.activePolicy.digest)}
                      </dd>
                    </div>
                    <div>
                      <dt>Route</dt>
                      <dd>Internal ledger</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <>
                  <strong>Fail closed</strong>
                  <p>
                    No policy is active, so no treasury proposal can be created.
                  </p>
                </>
              )}
              {role && canManageTreasuryPolicy(role) && (
                <button className="button" onClick={() => setEditor("policy")}>
                  {workspace?.activePolicy
                    ? "Replace policy"
                    : "Configure policy"}
                </button>
              )}
            </aside>
          </div>

          <section className="panel treasury-proposal-rail">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">IMMUTABLE HISTORY</span>
                <h2>Revenue split revisions</h2>
              </div>
            </div>
            <ProposalList
              proposals={workspace?.proposals ?? []}
              selectedId={selectedId}
              select={setSelectedId}
              loading={loading}
            />
          </section>
        </>
      ) : (
        <div className="approval-workspace">
          <section className="panel approval-queue">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">REVIEW QUEUE</span>
                <h2>Treasury revisions</h2>
              </div>
              <span className="api-mode">VERIFIED SESSION</span>
            </div>
            <ProposalList
              proposals={workspace?.proposals ?? []}
              selectedId={selectedId}
              select={setSelectedId}
              loading={loading}
            />
          </section>

          <section className="panel approval-review">
            {!selected ? (
              <p className="api-empty">
                Select an immutable revision to inspect.
              </p>
            ) : (
              <>
                <div className="approval-review-head">
                  <div>
                    <span className="eyebrow">
                      REVISION {selected.revision}
                    </span>
                    <h2>
                      {formatAtomic(selected.amountAtomic, DECIMALS)} Mock USDC
                    </h2>
                  </div>
                  <Status proposal={selected} />
                </div>

                {previous && (
                  <div className="revision-diff">
                    <span>Immutable revision diff</span>
                    <del>{formatAtomic(previous.amountAtomic, DECIMALS)}</del>
                    <Icon name="arrow" size={15} />
                    <ins>{formatAtomic(selected.amountAtomic, DECIMALS)}</ins>
                    <small>
                      Revision {previous.revision} approvals cannot carry
                      forward.
                    </small>
                  </div>
                )}

                <SplitBars amountAtomic={selected.amountAtomic} />

                <div className="digest-grid">
                  <div>
                    <span>Instruction digest</span>
                    <code title={selected.instructionDigest}>
                      {shortDigest(selected.instructionDigest)}
                    </code>
                  </div>
                  <div>
                    <span>Policy v{selected.policyVersion}</span>
                    <code title={selected.policyDigest}>
                      {shortDigest(selected.policyDigest)}
                    </code>
                  </div>
                  <div>
                    <span>Expires</span>
                    <strong>
                      {new Date(selected.expiresAt).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span>Environment</span>
                    <strong>Mock · internal ledger</strong>
                  </div>
                </div>

                <div
                  className="quorum-track"
                  aria-label={`${selected.approvals.length} of ${selected.approvalThreshold} approvals`}
                >
                  <div>
                    {Array.from(
                      { length: selected.approvalThreshold },
                      (_, index) => (
                        <i
                          key={index}
                          className={
                            index < selected.approvals.length ? "filled" : ""
                          }
                        />
                      ),
                    )}
                  </div>
                  <strong>
                    {selected.approvals.length} / {selected.approvalThreshold}
                  </strong>
                  <span>distinct eligible people</span>
                </div>

                <div className="approval-identities">
                  {selected.approvals.map((approval) => (
                    <div key={approval.approverUserId}>
                      <Icon name="check" size={14} />
                      <span>
                        <strong>{approval.approverNearAccountId}</strong>
                        <small>
                          Digest matched ·{" "}
                          {new Date(approval.createdAt).toLocaleString()}
                        </small>
                      </span>
                    </div>
                  ))}
                  {selected.approvals.length === 0 && (
                    <p>No approval has been recorded for this revision.</p>
                  )}
                </div>

                <div className="approval-disclosure">
                  <Icon name="shield" size={16} />
                  <p>
                    Approval uses the NEAR account already verified by the
                    signed login challenge. It records no new wallet signature
                    or chain transaction. Contract verification appears only
                    when a policy contract binding is configured.
                  </p>
                </div>

                {currentEvidence && (
                  <div className="contract-evidence">
                    <span className="eyebrow">EXECUTION EVIDENCE</span>
                    <strong>
                      {currentEvidence.verification.verification === "contract"
                        ? "Final NEAR contract state verified"
                        : "Off-chain quorum reverified"}
                    </strong>
                    <p>
                      Funds were reserved in the internal ledger. No transfer
                      was sent.
                    </p>
                    {currentEvidence.verification.evidence && (
                      <a
                        href={`https://testnet.nearblocks.io/address/${encodeURIComponent(currentEvidence.verification.evidence.contractAccountId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open contract in testnet explorer{" "}
                        <Icon name="northeast" size={13} />
                      </a>
                    )}
                  </div>
                )}

                <div className="modal-actions approval-actions">
                  {role &&
                    canCreateTreasuryProposal(role) &&
                    effectiveStatus(selected) !== "EXPIRED" &&
                    ["PENDING", "APPROVED"].includes(selected.status) && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          setAmount(
                            formatAtomic(selected.amountAtomic, DECIMALS),
                          );
                          setSourceAccountId(
                            selected.operation.slice("reserve_split:".length),
                          );
                          setExpiresAt(isoInput());
                          setEditor("revise");
                        }}
                      >
                        Edit as new revision
                      </button>
                    )}
                  {role &&
                    canCreateTreasuryProposal(role) &&
                    selected.status === "PENDING" && (
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() =>
                          void mutate(() =>
                            cofferApi.cancelTreasurySplit(
                              organizationId!,
                              selected.id,
                            ),
                          )
                        }
                      >
                        Reject revision
                      </button>
                    )}
                  {role &&
                    canApproveTreasuryProposal(role) &&
                    selected.status === "PENDING" &&
                    effectiveStatus(selected) !== "EXPIRED" && (
                      <button
                        className="button dark"
                        disabled={busy || alreadyApproved || !currentWallet}
                        onClick={() =>
                          currentWallet &&
                          void mutate(() =>
                            cofferApi.approveTreasurySplit(
                              organizationId!,
                              selected.id,
                              currentWallet.accountId,
                            ),
                          )
                        }
                      >
                        {alreadyApproved
                          ? "You approved this revision"
                          : `Approve as ${currentWallet?.accountId ?? "verified wallet"}`}
                      </button>
                    )}
                  {role &&
                    canReserveTreasuryProposal(role) &&
                    selected.status === "APPROVED" &&
                    effectiveStatus(selected) !== "EXPIRED" && (
                      <button
                        className="button dark"
                        disabled={busy}
                        onClick={() => void reserve()}
                      >
                        Verify & reserve funds
                      </button>
                    )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {(editor === "create" || editor === "revise") && (
        <Modal
          title={
            editor === "revise"
              ? "A new immutable revision."
              : "Split with precision."
          }
          close={() => setEditor(null)}
        >
          <span className="eyebrow">SERVER-DERIVED · 50 / 30 / 20</span>
          <form
            className="form-stack"
            onSubmit={(event) => void submitSplit(event)}
          >
            <label>
              Source ledger account
              <select
                required
                value={sourceAccountId}
                onChange={(event) => setSourceAccountId(event.target.value)}
              >
                <option value="">Select an account</option>
                {workspace?.accounts
                  .filter((account) => account.accountType === "ASSET")
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ·{" "}
                      {formatAtomic(account.availableBalanceAtomic, DECIMALS)}{" "}
                      available
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Total · Mock USDC
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              Approval expiry
              <input
                required
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
            {previewAtomic(amount) && (
              <SplitBars amountAtomic={previewAtomic(amount)!} />
            )}
            <p className="form-note">
              Coffer computes the allocation, commitments, nonce, policy
              decision, and digest on the server. Editing creates a new revision
              and clears quorum.
            </p>
            {error && (
              <p className="form-alert" role="alert">
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
                  ? "Checking policy…"
                  : editor === "revise"
                    ? "Create revision"
                    : "Submit for approval"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editor === "policy" && (
        <Modal
          title="A policy that fails closed."
          close={() => setEditor(null)}
        >
          <span className="eyebrow">OWNER ONLY · 2 DISTINCT PEOPLE</span>
          <form
            className="form-stack"
            onSubmit={(event) => void submitPolicy(event)}
          >
            <label>
              Per-split cap · Mock USDC
              <input
                required
                inputMode="decimal"
                value={policyCap}
                onChange={(event) => setPolicyCap(event.target.value)}
              />
            </label>
            <label>
              30-day rolling cap · Mock USDC
              <input
                required
                inputMode="decimal"
                value={policyRollingCap}
                onChange={(event) => setPolicyRollingCap(event.target.value)}
              />
            </label>
            <label>
              Policy expiry
              <input
                required
                type="datetime-local"
                value={policyExpiresAt}
                onChange={(event) => setPolicyExpiresAt(event.target.value)}
              />
            </label>
            <p className="form-note">
              Replacing the policy makes pending and approved proposals stale.
              The fixed recipient commitment permits only the 50/30/20 internal
              split.
            </p>
            {error && (
              <p className="form-alert" role="alert">
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
                {busy ? "Activating…" : "Activate policy"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ProposalList({
  proposals,
  selectedId,
  select,
  loading,
}: {
  proposals: TreasuryProposal[];
  selectedId: string | null;
  select: (id: string) => void;
  loading: boolean;
}) {
  if (loading) return <p className="api-empty">Loading immutable revisions…</p>;
  if (proposals.length === 0)
    return <p className="api-empty">No treasury split has been proposed.</p>;
  return (
    <div className="treasury-proposal-list">
      {proposals.map((proposal) => (
        <button
          key={proposal.id}
          className={selectedId === proposal.id ? "selected" : ""}
          onClick={() => select(proposal.id)}
        >
          <span>
            <strong>Split #{proposal.revision}</strong>
            <small>{new Date(proposal.createdAt).toLocaleString()}</small>
          </span>
          <b>{formatAtomic(proposal.amountAtomic, DECIMALS)}</b>
          <span>
            <Status proposal={proposal} />
            <small>
              {proposal.approvals.length}/{proposal.approvalThreshold} approvals
            </small>
          </span>
          <Icon name="northeast" size={15} />
        </button>
      ))}
    </div>
  );
}
