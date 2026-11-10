"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";
import { Modal } from "@/components/coffer/workspace";
import {
  ApiError,
  cofferApi,
  type OrganizationMember,
  type PayrollAnalysis,
  type PayrollBatch,
  type PayrollPayoutRun,
  type PayrollSummary,
  type Payslip,
} from "@/lib/coffer-api";
import { manualPayrollCsv, type ManualPayrollLine } from "@/lib/payroll-manual";
import { canManagePayroll } from "@/lib/workspace-access";

const csvHeader =
  "employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic";
const emptyManualLine: ManualPayrollLine = {
  employeeCode: "",
  userId: "",
  legalName: "",
  address: "",
  payoutAccount: "",
  grossAmountAtomic: "",
};
const payrollAssets = [
  { id: "mock:near:usdc", label: "Mock USDC · NEAR-like" },
  { id: "mock:base:usdc", label: "Mock USDC · Base-like" },
  { id: "near:testnet:native", label: "Native testnet NEAR · evidence only" },
] as const;

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UNAVAILABLE")
      return "Verified private AI is unavailable or disabled. No private-inference result was accepted.";
    if (error.code === "CONFLICT")
      return "The payroll manifest changed or this reference already exists. Refresh before approving.";
    if (error.code === "FORBIDDEN")
      return "Your role cannot access this payroll action.";
    if (error.code === "INVALID_RESPONSE")
      return "Coffer rejected an invalid payroll response.";
  }
  return "The payroll request could not be completed.";
}

function short(value: string): string {
  return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function Status({ value }: { value: string }) {
  return (
    <span className={`api-status is-${value.toLowerCase()}`}>{value}</span>
  );
}

export function AuthenticatedPayroll() {
  const { currentOrganization } = useAuth();
  const role = currentOrganization?.role;
  if (role === "EMPLOYEE") return <EmployeePayslips />;
  if (role && canManagePayroll(role)) return <FinancePayroll />;
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">PURPOSE LIMITED · NO PLAINTEXT EXPORT</span>
          <h1>
            Payroll without <em>quiet disclosure.</em>
          </h1>
          <p>
            Auditor access remains a purpose-recorded, redacted API view. Use
            Activity for the immutable audit trail; individual pay is omitted.
          </p>
        </div>
      </header>
      <section className="panel payroll-empty-boundary">
        This role cannot open finance payroll plaintext or employee payslips.
      </section>
    </>
  );
}

function FinancePayroll() {
  const { currentOrganization, session, signPayrollPayout } = useAuth();
  const organizationId = currentOrganization?.id;
  const [batches, setBatches] = useState<PayrollSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PayrollBatch | null>(null);
  const [analysis, setAnalysis] = useState<PayrollAnalysis | null>(null);
  const [payout, setPayout] = useState<PayrollPayoutRun | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [employees, setEmployees] = useState<OrganizationMember[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [manualLines, setManualLines] = useState<ManualPayrollLine[]>([]);
  const [manualLine, setManualLine] =
    useState<ManualPayrollLine>(emptyManualLine);
  const [manualEntryError, setManualEntryError] = useState("");
  const [reference, setReference] = useState("");
  const [assetId, setAssetId] = useState("mock:near:usdc");
  const [perEmployeeCapAtomic, setPerEmployeeCapAtomic] = useState("100000000");
  const [batchCapAtomic, setBatchCapAtomic] = useState("1000000000");
  const [csv, setCsv] = useState(`${csvHeader}\n`);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async (preferredId?: string) => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const next = await cofferApi.payrollBatches(organizationId);
      const nextId =
        preferredId && next.some(({ id }) => id === preferredId)
          ? preferredId
          : next.some(({ id }) => id === selectedId)
            ? selectedId
            : (next[0]?.id ?? null);
      setBatches(next);
      setSelectedId(nextId);
      setSelected(
        nextId ? await cofferApi.payrollBatch(organizationId, nextId) : null,
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
      .payrollBatches(organizationId)
      .then(async (next) => ({
        next,
        batch: next[0]
          ? await cofferApi.payrollBatch(organizationId, next[0].id)
          : null,
      }))
      .then(({ next, batch }) => {
        if (!active) return;
        setBatches(next);
        setSelectedId(batch?.id ?? null);
        setSelected(batch);
      })
      .catch((cause) => active && setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [organizationId]);

  const choose = async (id: string) => {
    if (!organizationId) return;
    setSelectedId(id);
    setAnalysis(null);
    setPayout(null);
    setError("");
    try {
      setSelected(await cofferApi.payrollBatch(organizationId, id));
    } catch (cause) {
      setError(message(cause));
    }
  };

  const createBatch = async (
    csvPayload: string,
    close: () => void,
    onError: (value: string) => void,
  ) => {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const created = await cofferApi.importPayroll(organizationId, {
        reference,
        assetId,
        synthetic: true,
        perEmployeeCapAtomic,
        batchCapAtomic,
        csv: csvPayload,
      });
      close();
      setAnalysis(null);
      setPayout(null);
      await load(created.id);
    } catch (cause) {
      onError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const importBatch = async (event: FormEvent) => {
    event.preventDefault();
    await createBatch(csv, () => setShowImport(false), setError);
  };

  const openManual = async () => {
    if (!organizationId) return;
    setShowManual(true);
    setEmployeesLoading(true);
    setManualEntryError("");
    try {
      setEmployees(await cofferApi.organizationMembers(organizationId));
    } catch (cause) {
      setManualEntryError(message(cause));
    } finally {
      setEmployeesLoading(false);
    }
  };

  const selectEmployee = (userId: string) => {
    const member = employees.find((candidate) => candidate.userId === userId);
    setManualLine((current) => ({
      ...current,
      userId,
      legalName: member?.displayName ?? "",
      payoutAccount:
        member?.wallets.find(({ network }) => network === "testnet")
          ?.accountId ?? "",
    }));
  };

  const addManualLine = (event: FormEvent) => {
    event.preventDefault();
    if (
      manualLines.some(
        (line) =>
          line.userId === manualLine.userId ||
          line.employeeCode === manualLine.employeeCode,
      )
    ) {
      setManualEntryError(
        "Each employee and employee code can appear only once in a batch.",
      );
      return;
    }
    setManualLines((current) => [...current, manualLine]);
    setManualLine(emptyManualLine);
    setManualEntryError("");
  };

  const importManualBatch = async (event: FormEvent) => {
    event.preventDefault();
    if (!manualLines.length) return;
    await createBatch(
      manualPayrollCsv(manualLines),
      () => {
        setShowManual(false);
        setManualLines([]);
        setManualLine(emptyManualLine);
        setManualEntryError("");
      },
      setManualEntryError,
    );
  };

  const analyze = async (mode: "deterministic" | "private-ai") => {
    if (!organizationId || !selected) return;
    setBusy(true);
    setError("");
    setAnalysis(null);
    try {
      setAnalysis(
        await cofferApi.analyzePayroll(organizationId, selected.id, mode),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!organizationId || !selected) return;
    setBusy(true);
    setError("");
    try {
      await cofferApi.approvePayroll(
        organizationId,
        selected.id,
        selected.manifestDigest,
        selected.version,
      );
      await load(selected.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const preparePayout = async () => {
    if (!organizationId || !selected) return;
    const signerAccountId = session?.wallets.find(
      ({ network }) => network === "testnet",
    )?.accountId;
    if (!signerAccountId) {
      setError("Connect and verify a NEAR wallet before preparing payroll.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setPayout(
        await cofferApi.preparePayrollPayout(
          organizationId,
          selected.id,
          signerAccountId,
          `payroll:${selected.id}:v${selected.version}`,
        ),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const pay = async (itemId: string) => {
    if (!organizationId || !selected || !payout) return;
    const item = payout.items.find(({ id }) => id === itemId);
    if (!item?.transaction) return;
    setBusy(true);
    setError("");
    try {
      const transactionHash = await signPayrollPayout(item.transaction);
      setPayout(
        await cofferApi.reconcilePayrollPayout(
          organizationId,
          selected.id,
          item.id,
          transactionHash,
        ),
      );
      await load(selected.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const eligibleEmployees = employees.filter(({ role }) => role === "EMPLOYEE");

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">SYNTHETIC ONLY · ENCRYPTED AT REST</span>
          <h1>
            Review the manifest, <em>not a promise.</em>
          </h1>
          <p>
            Exact atomic amounts are encrypted before persistence. Analysis can
            flag a row; only a human approves the immutable manifest.
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
          <button className="button" onClick={() => setShowImport(true)}>
            Import CSV
          </button>
          <button className="button dark" onClick={() => void openManual()}>
            <Icon name="plus" size={16} /> Add employees
          </button>
        </div>
      </header>

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      <section
        className="payroll-truth-strip"
        aria-label="Payroll privacy boundary"
      >
        <div>
          <span>Data class</span>
          <strong>Synthetic</strong>
          <small>Real payroll is prohibited in this demo.</small>
        </div>
        <div>
          <span>Calculation</span>
          <strong>No tax</strong>
          <small>Gross equals net; no legal payroll claim.</small>
        </div>
        <div>
          <span>Payout privacy</span>
          <strong>Not implied</strong>
          <small>
            Application encryption does not hide public-chain transfers.
          </small>
        </div>
      </section>

      <div className="automation-layout">
        <section className="panel automation-rail">
          <div className="panel-heading">
            <span>Encrypted batches</span>
            <span className="api-mode">{batches.length} BATCHES</span>
          </div>
          {loading ? (
            <p className="api-empty" aria-busy="true">
              Loading payroll…
            </p>
          ) : !batches.length ? (
            <p className="api-empty">No synthetic payroll batch yet.</p>
          ) : (
            <div className="automation-list">
              {batches.map((batch) => (
                <button
                  key={batch.id}
                  className={batch.id === selectedId ? "selected" : ""}
                  onClick={() => void choose(batch.id)}
                >
                  <span>
                    <strong>{batch.reference}</strong>
                    <small>{batch.lineCount} encrypted rows</small>
                  </span>
                  <Status value={batch.status} />
                  <Icon name="arrow" size={15} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel automation-review payroll-review">
          {selected ? (
            <>
              <div className="automation-review-head">
                <div>
                  <span className="eyebrow">MANIFEST V{selected.version}</span>
                  <h2>{selected.reference}</h2>
                </div>
                <Status value={selected.status} />
              </div>
              <dl className="payroll-manifest">
                <div>
                  <dt>Asset</dt>
                  <dd>{selected.assetId}</dd>
                </div>
                <div>
                  <dt>Total gross · atomic</dt>
                  <dd>{selected.totalGrossAtomic}</dd>
                </div>
                <div>
                  <dt>Manifest digest</dt>
                  <dd title={selected.manifestDigest}>
                    {short(selected.manifestDigest)}
                  </dd>
                </div>
                <div>
                  <dt>Calculation</dt>
                  <dd>{selected.calculationAssumption}</dd>
                </div>
              </dl>
              <div
                className="payroll-lines"
                aria-label="Authorized payroll rows"
              >
                {selected.lines.map((line) => (
                  <article key={line.id}>
                    <div>
                      <strong>{line.employeeCode}</strong>
                      <small>{line.profile.legalName}</small>
                    </div>
                    <div>
                      <strong>{line.netAmountAtomic}</strong>
                      <small>{selected.assetId} atomic</small>
                    </div>
                    <div>
                      <strong>{line.profile.payoutAccount}</strong>
                      <small>{line.profile.address}</small>
                    </div>
                  </article>
                ))}
              </div>
              <div className="payroll-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void analyze("deterministic")}
                >
                  Run local rules
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void analyze("private-ai")}
                >
                  Try verified private AI
                </button>
                <button
                  className="button dark"
                  disabled={busy || selected.status !== "DRAFT"}
                  onClick={() => void approve()}
                >
                  Approve exact manifest
                </button>
                <button
                  className="button dark"
                  disabled={
                    busy ||
                    !["APPROVED", "PROCESSING", "SETTLED"].includes(
                      selected.status,
                    ) ||
                    !selected.assetId.startsWith("near:testnet:")
                  }
                  onClick={() => void preparePayout()}
                >
                  Prepare wallet payouts
                </button>
              </div>
              {payout && (
                <section
                  className="payroll-analysis"
                  aria-label="Payroll payout verification"
                >
                  <div>
                    <strong>{payout.status}</strong>
                    <span>{payout.signerAccountId}</span>
                  </div>
                  <p>
                    Each wallet approval is reconciled against the exact
                    approved employee transfer before settlement.
                  </p>
                  {payout.items.map((item) => (
                    <div key={item.id} className="button-row">
                      <span>
                        {selected.lines.find(
                          ({ id }) => id === item.payrollLineId,
                        )?.employeeCode ?? "Payroll line"}{" "}
                        · {item.status}
                      </span>
                      {item.transaction && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => void pay(item.id)}
                        >
                          Sign and verify payout
                        </button>
                      )}
                      {item.transactionHash && (
                        <small title={item.transactionHash}>
                          {short(item.transactionHash)}
                        </small>
                      )}
                    </div>
                  ))}
                </section>
              )}
              {analysis && (
                <section
                  className="payroll-analysis"
                  aria-label="Analysis evidence"
                >
                  <div>
                    <strong>{analysis.attestationStatus}</strong>
                    <span>{analysis.mode}</span>
                  </div>
                  <p>{analysis.confidentiality}</p>
                  {analysis.findings.length ? (
                    analysis.findings.map((finding) => (
                      <p key={`${finding.lineId}-${finding.code}`}>
                        {finding.severity} · {finding.code} —{" "}
                        {finding.explanation}
                      </p>
                    ))
                  ) : (
                    <p>No rule findings.</p>
                  )}
                </section>
              )}
            </>
          ) : (
            <p className="api-empty">
              Select or import a synthetic payroll batch.
            </p>
          )}
        </section>
      </div>

      {showImport && (
        <form className="panel payroll-import" onSubmit={importBatch}>
          <div>
            <span className="eyebrow">
              STRICT CSV · UUID EMPLOYEE MEMBERSHIPS
            </span>
            <h2>Import synthetic payroll</h2>
            <p>
              Every user ID must belong to an active employee in this
              organization. Values are exact positive integers.
            </p>
          </div>
          <div className="payroll-import-fields">
            <label>
              Reference
              <input
                required
                pattern="[A-Za-z0-9._-]+"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </label>
            <label>
              Canonical asset
              <select
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                {payrollAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Per employee cap · atomic
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                value={perEmployeeCapAtomic}
                onChange={(event) =>
                  setPerEmployeeCapAtomic(event.target.value)
                }
              />
            </label>
            <label>
              Batch cap · atomic
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                value={batchCapAtomic}
                onChange={(event) => setBatchCapAtomic(event.target.value)}
              />
            </label>
            <label className="payroll-csv">
              Synthetic CSV
              <textarea
                required
                rows={7}
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
              />
            </label>
            <div className="payroll-actions">
              <button
                type="button"
                className="button"
                onClick={() => setShowImport(false)}
              >
                Cancel
              </button>
              <button className="button dark" disabled={busy}>
                Encrypt and import
              </button>
            </div>
          </div>
        </form>
      )}

      {showManual && (
        <Modal
          title="Build payroll manually"
          close={() => setShowManual(false)}
          wide
        >
          <p className="modal-description">
            Add active employee members one at a time. Coffer submits the same
            strict, encrypted synthetic batch used by CSV import.
          </p>
          <form
            id="manual-payroll-batch"
            className="payroll-import-fields"
            onSubmit={importManualBatch}
          >
            <label>
              Reference
              <input
                required
                maxLength={64}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </label>
            <label>
              Canonical asset
              <select
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                {payrollAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Per employee cap · atomic
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{0,77}"
                value={perEmployeeCapAtomic}
                onChange={(event) =>
                  setPerEmployeeCapAtomic(event.target.value)
                }
              />
            </label>
            <label>
              Batch cap · atomic
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{0,77}"
                value={batchCapAtomic}
                onChange={(event) => setBatchCapAtomic(event.target.value)}
              />
            </label>
          </form>

          <form
            className="payroll-import-fields payroll-manual-entry"
            onSubmit={addManualLine}
          >
            <label className="payroll-wide-field">
              Employee member
              <select
                required
                value={manualLine.userId}
                disabled={employeesLoading || !eligibleEmployees.length}
                onChange={(event) => selectEmployee(event.target.value)}
              >
                <option value="">
                  {employeesLoading
                    ? "Loading employees…"
                    : eligibleEmployees.length
                      ? "Select an employee"
                      : "No active employee members"}
                </option>
                {eligibleEmployees.map((employee) => (
                  <option key={employee.userId} value={employee.userId}>
                    {employee.displayName}
                    {employee.wallets[0]
                      ? ` · ${employee.wallets[0].accountId}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Employee code
              <input
                required
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
                value={manualLine.employeeCode}
                onChange={(event) =>
                  setManualLine((current) => ({
                    ...current,
                    employeeCode: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Legal name · synthetic
              <input
                required
                maxLength={120}
                value={manualLine.legalName}
                onChange={(event) =>
                  setManualLine((current) => ({
                    ...current,
                    legalName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Address · synthetic
              <input
                required
                maxLength={300}
                value={manualLine.address}
                onChange={(event) =>
                  setManualLine((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Payout account
              <input
                required
                maxLength={200}
                value={manualLine.payoutAccount}
                onChange={(event) =>
                  setManualLine((current) => ({
                    ...current,
                    payoutAccount: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Gross amount · atomic
              <input
                required
                inputMode="numeric"
                pattern="[1-9][0-9]{0,77}"
                value={manualLine.grossAmountAtomic}
                onChange={(event) =>
                  setManualLine((current) => ({
                    ...current,
                    grossAmountAtomic: event.target.value,
                  }))
                }
              />
            </label>
            <div className="payroll-actions payroll-wide-field">
              <button
                className="button"
                disabled={employeesLoading || !eligibleEmployees.length}
              >
                Add employee
              </button>
            </div>
          </form>

          {!eligibleEmployees.length && !employeesLoading && (
            <p className="form-alert" role="status">
              Invite a wallet as an EMPLOYEE and have it accept the invitation
              before building payroll.
            </p>
          )}
          {manualEntryError && (
            <p className="form-alert" role="alert">
              {manualEntryError}
            </p>
          )}
          <div className="payroll-manual-lines" aria-live="polite">
            {manualLines.map((line) => (
              <div key={line.userId}>
                <span>
                  <strong>{line.employeeCode}</strong>
                  <small>{line.legalName}</small>
                </span>
                <span>
                  <strong>{line.grossAmountAtomic}</strong>
                  <small>{assetId} atomic</small>
                </span>
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    setManualLines((current) =>
                      current.filter(({ userId }) => userId !== line.userId),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              onClick={() => setShowManual(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="manual-payroll-batch"
              className="button dark"
              disabled={busy || !manualLines.length}
            >
              Encrypt and import {manualLines.length || ""} employee
              {manualLines.length === 1 ? "" : "s"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function EmployeePayslips() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    cofferApi
      .payslips()
      .then((next) => {
        if (!active) return;
        setPayslips(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch((cause) => active && setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const selected = payslips.find(({ id }) => id === selectedId) ?? null;
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">SELF ONLY · AUDITED READ</span>
          <h1>
            Your pay, <em>your view.</em>
          </h1>
          <p>
            This endpoint is bound to your authenticated user and active
            employee membership. It cannot browse another employee.
          </p>
        </div>
      </header>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      <section className="payroll-truth-strip">
        <div>
          <span>Scope</span>
          <strong>Self only</strong>
          <small>Cross-user reads are hidden as not found.</small>
        </div>
        <div>
          <span>Storage</span>
          <strong>Encrypted</strong>
          <small>Decrypted only for this authorized response.</small>
        </div>
        <div>
          <span>Chain privacy</span>
          <strong>Not claimed</strong>
          <small>A later public payout may remain observable.</small>
        </div>
      </section>
      <div className="automation-layout">
        <section className="panel automation-rail">
          <div className="panel-heading">
            <span>My payslips</span>
            <span className="api-mode">{payslips.length}</span>
          </div>
          {loading ? (
            <p className="api-empty">Loading your payslips…</p>
          ) : (
            payslips.map((payslip) => (
              <div className="automation-list" key={payslip.id}>
                <button
                  className={payslip.id === selectedId ? "selected" : ""}
                  onClick={() => setSelectedId(payslip.id)}
                >
                  <span>
                    <strong>{payslip.reference}</strong>
                    <small>{payslip.employeeCode}</small>
                  </span>
                  <Status value={payslip.status} />
                  <Icon name="arrow" size={15} />
                </button>
              </div>
            ))
          )}
        </section>
        <section className="panel automation-review payroll-review">
          {selected ? (
            <>
              <div className="automation-review-head">
                <div>
                  <span className="eyebrow">SYNTHETIC PAYSLIP</span>
                  <h2>{selected.legalName}</h2>
                </div>
                <Status value={selected.status} />
              </div>
              <dl className="payroll-manifest">
                <div>
                  <dt>Net · atomic</dt>
                  <dd>{selected.netAmountAtomic}</dd>
                </div>
                <div>
                  <dt>Asset</dt>
                  <dd>{selected.assetId}</dd>
                </div>
                <div>
                  <dt>Payout account</dt>
                  <dd>{selected.payoutAccount}</dd>
                </div>
                <div>
                  <dt>Calculation</dt>
                  <dd>{selected.calculationAssumption}</dd>
                </div>
              </dl>
              <p className="automation-warning">{selected.confidentiality}</p>
            </>
          ) : (
            <p className="api-empty">No payslip is available for your user.</p>
          )}
        </section>
      </div>
    </>
  );
}
