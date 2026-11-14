"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";
import { StateToast } from "@/components/ui/state-toast";
import {
  ApiError,
  cofferApi,
  type AuditPage,
  type FinanceAgentRun,
  type OperationsDashboard,
  type OperationsMetrics,
} from "@/lib/coffer-api";
import {
  canReadOperations,
  canReconcileOperations,
} from "@/lib/workspace-access";

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "FORBIDDEN")
      return "Your role cannot perform that operator action.";
    if (error.code === "CONFLICT")
      return "That recheck key conflicts with an earlier request.";
    if (error.code === "INVALID_RESPONSE")
      return "Coffer rejected an invalid operations response.";
  }
  return "The operations view could not be loaded.";
}

function short(value: string | null): string {
  if (!value) return "—";
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

export function AuthenticatedOperations() {
  const { currentOrganization } = useAuth();
  const organizationId = currentOrganization?.id;
  const role = currentOrganization?.role;
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [metrics, setMetrics] = useState<OperationsMetrics | null>(null);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [financeRuns, setFinanceRuns] = useState<FinanceAgentRun[]>([]);
  const [eventType, setEventType] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const apply = ([nextDashboard, nextMetrics, nextAudit, nextFinanceRuns]: [
    OperationsDashboard,
    OperationsMetrics,
    AuditPage,
    FinanceAgentRun[],
  ]) => {
    setDashboard(nextDashboard);
    setMetrics(nextMetrics);
    setAudit(nextAudit);
    setFinanceRuns(nextFinanceRuns);
  };

  const load = async (filter = activeFilter) => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      apply(
        await Promise.all([
          cofferApi.operationsDashboard(organizationId),
          cofferApi.operationsMetrics(organizationId),
          cofferApi.auditEvents(organizationId, filter || undefined),
          cofferApi.financeAgentRuns(organizationId),
        ]),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!organizationId || !role || !canReadOperations(role)) return;
    let active = true;
    Promise.all([
      cofferApi.operationsDashboard(organizationId),
      cofferApi.operationsMetrics(organizationId),
      cofferApi.auditEvents(organizationId),
      cofferApi.financeAgentRuns(organizationId),
    ])
      .then((result) => active && apply(result))
      .catch((cause) => active && setError(message(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [organizationId, role]);

  const filter = async (event: FormEvent) => {
    event.preventDefault();
    const next = eventType.trim();
    setActiveFilter(next);
    await load(next);
  };

  const older = async () => {
    if (!organizationId || !audit?.nextCursor) return;
    setLoading(true);
    setError("");
    try {
      const next = await cofferApi.auditEvents(
        organizationId,
        activeFilter || undefined,
        audit.nextCursor,
      );
      setAudit({ ...next, events: [...audit.events, ...next.events] });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  };

  const recheck = async (caseId: string) => {
    if (!organizationId) return;
    setBusyCaseId(caseId);
    setError("");
    setNotice("");
    try {
      const action = await cofferApi.recheckReconciliation(
        organizationId,
        caseId,
      );
      setNotice(
        `${action.action.replaceAll("_", " ")} queued. The payment remains uncertain until verified reconciliation.`,
      );
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusyCaseId(null);
    }
  };

  if (!role || !canReadOperations(role)) {
    return (
      <p className="form-alert">Your role cannot read settlement operations.</p>
    );
  }

  const mayRecheck = canReconcileOperations(role);
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">RECONCILIATION · HASH-CHAINED AUDIT</span>
          <h1>
            Uncertainty stays <em>visible.</em>
          </h1>
          <p>
            A recheck only queues observation of an existing payment. It cannot
            post money, overwrite status, or turn an unknown outcome into
            success.
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
        </div>
      </header>

      <StateToast id="operations-error" message={error} />
      <StateToast id="operations-notice" kind="success" message={notice} />

      <section className="operations-metrics" aria-label="Operations metrics">
        <article>
          <span>Queued effects</span>
          <strong>{metrics?.queuedOutboxEvents ?? "—"}</strong>
          <small>
            {metrics?.oldestQueuedAt
              ? `Oldest ${new Date(metrics.oldestQueuedAt).toLocaleString()}`
              : "No queued effect"}
          </small>
        </article>
        <article>
          <span>Open cases</span>
          <strong>{metrics?.openReconciliationCases ?? "—"}</strong>
          <small>Manual review, never blind retry</small>
        </article>
        <article>
          <span>Stale pending</span>
          <strong>{metrics?.stalePendingPayments ?? "—"}</strong>
          <small>
            Older than {dashboard?.stuckThresholdSeconds ?? 300} seconds
          </small>
        </article>
        <article className={audit?.integrity.verified ? "verified" : "failed"}>
          <span>Audit integrity</span>
          <strong>
            {audit?.integrity.verified ? "Verified" : "Unverified"}
          </strong>
          <small>
            {audit
              ? `${audit.integrity.eventCount} events · ${audit.integrity.algorithm}`
              : "Checking chain"}
          </small>
        </article>
      </section>

      <section
        className="panel finance-agent-history"
        aria-label="Finance Agent run timeline"
      >
        <div className="finance-agent-heading">
          <div>
            <span className="eyebrow">EVIDENCE-BOUND AUTONOMY</span>
            <h2>Finance Agent runs</h2>
            <p>
              Verified business events may advance bounded work. External
              authority remains behind human approval, and the API never signs.
            </p>
          </div>
          <strong>{financeRuns.length}</strong>
        </div>
        <div className="finance-agent-runs">
          {financeRuns.map((run) => (
            <article key={run.id} className="finance-agent-run">
              <header>
                <div>
                  <Status value={run.state} />
                  <h3>{run.objective.replaceAll("_", " ")}</h3>
                  <small>
                    Correlation {short(run.correlationId)} · Run {short(run.id)}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>Policy</dt>
                    <dd>
                      {run.policy.outcome ?? "Pending"} · v
                      {run.policy.version ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Reserved</dt>
                    <dd>
                      {run.reservation
                        ? `${run.reservation.amountAtomic} ${run.reservation.assetId}`
                        : "Not reserved"}
                    </dd>
                  </div>
                  <div>
                    <dt>Authorization</dt>
                    <dd>{run.approvalBoundary.proposalStatus}</dd>
                  </div>
                  <div>
                    <dt>Reconciliation</dt>
                    <dd>{run.reconciliation.paymentStatus}</dd>
                  </div>
                </dl>
              </header>
              <ol className="finance-agent-steps">
                {run.steps.map((step) => (
                  <li
                    key={step.code}
                    className={`is-${step.status.toLowerCase()}`}
                  >
                    <span aria-hidden="true" />
                    <div>
                      <small>{step.code.replaceAll("_", " ")}</small>
                      <strong>{step.title}</strong>
                      <p>{step.detail.replaceAll("_", " ")}</p>
                      {step.occurredAt && (
                        <time dateTime={step.occurredAt}>
                          {new Date(step.occurredAt).toLocaleString()}
                        </time>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <footer>
                <span>
                  Backend signing: <strong>disabled</strong>
                </span>
                <span>
                  Execution: <strong>seeded fulfilment only</strong>
                </span>
                <code title={run.policy.instructionDigest ?? undefined}>
                  Digest {short(run.policy.instructionDigest)}
                </code>
              </footer>
            </article>
          ))}
          {!loading && financeRuns.length === 0 && (
            <p className="api-empty">
              No verified settlement has started a Finance Agent run yet.
            </p>
          )}
        </div>
      </section>

      <div className="operations-board">
        <OperationColumn
          title="Queued"
          count={dashboard?.queued.length ?? 0}
          description="Durable outbox effects awaiting publication"
        >
          {dashboard?.queued.map((item) => (
            <article key={item.id}>
              <Status value={item.topic} />
              <strong>{short(item.aggregateId)}</strong>
              <small>
                {item.attempts} attempts · {item.lastErrorCode ?? "no error"}
              </small>
            </article>
          ))}
        </OperationColumn>
        <OperationColumn
          title="Pending"
          count={dashboard?.pending.length ?? 0}
          description="Provider outcome is not final"
        >
          {dashboard?.pending.map((item) => (
            <Attempt key={item.id} item={item} />
          ))}
        </OperationColumn>
        <OperationColumn
          title="Needs reconciliation"
          count={dashboard?.stuck.length ?? 0}
          description="Unknown, open case, or past threshold"
        >
          {dashboard?.stuck.map((item) => (
            <Attempt key={item.id} item={item}>
              {item.reconciliationCase &&
                mayRecheck &&
                item.status === "UNKNOWN_REQUIRES_RECONCILIATION" && (
                  <button
                    className="button"
                    disabled={busyCaseId === item.reconciliationCase.id}
                    onClick={() => void recheck(item.reconciliationCase!.id)}
                  >
                    Queue safe recheck
                  </button>
                )}
            </Attempt>
          ))}
        </OperationColumn>
        <OperationColumn
          title="Final outcomes"
          count={
            (dashboard?.refunded.length ?? 0) +
            (dashboard?.completed.length ?? 0)
          }
          description="Verified refunds and settlements"
        >
          {dashboard?.refunded.map((item) => (
            <Attempt key={item.id} item={item} />
          ))}
          {dashboard?.completed.map((item) => (
            <Attempt key={item.id} item={item} />
          ))}
        </OperationColumn>
      </div>

      <section className="panel audit-timeline">
        <div className="audit-heading">
          <div>
            <span className="eyebrow">IMMUTABLE ORGANIZATION HISTORY</span>
            <h2>Redacted audit timeline</h2>
            <p>
              Head {short(audit?.integrity.headHash ?? null)} · metadata is
              recursively redacted server-side.
            </p>
          </div>
          <form onSubmit={filter}>
            <label>
              Exact event type
              <input
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                placeholder="PAYMENT_STATUS_CHANGED"
              />
            </label>
            <button className="button" disabled={loading}>
              Filter
            </button>
          </form>
        </div>
        <div className="audit-events">
          {audit?.events.map((event) => (
            <article key={event.id}>
              <span>{String(event.sequence).padStart(4, "0")}</span>
              <div>
                <strong>{event.eventType}</strong>
                <small>
                  {event.entityType} · {short(event.entityId)}
                </small>
              </div>
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
              <code title={event.eventHash}>{short(event.eventHash)}</code>
            </article>
          ))}
          {!loading && !audit?.events.length && (
            <p className="api-empty">
              No audit event matches this exact filter.
            </p>
          )}
        </div>
        {audit?.nextCursor && (
          <button
            className="button audit-more"
            onClick={() => void older()}
            disabled={loading}
          >
            Load older events
          </button>
        )}
      </section>
    </>
  );
}

function OperationColumn({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count: number;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="panel operation-column">
      <header>
        <span>{title}</span>
        <strong>{count}</strong>
        <small>{description}</small>
      </header>
      <div>
        {children}
        {count === 0 && <p className="api-empty">Nothing in this state.</p>}
      </div>
    </section>
  );
}

function Attempt({
  item,
  children,
}: {
  item: OperationsDashboard["stuck"][number];
  children?: ReactNode;
}) {
  return (
    <article>
      <Status value={item.status} />
      <strong>{short(item.id)}</strong>
      <small>
        {item.provider} · polled {item.pollCount}×
      </small>
      {item.reconciliationCase && (
        <small>
          {item.reconciliationCase.reasonCode} ·{" "}
          {item.reconciliationCase.status}
        </small>
      )}
      {children}
    </article>
  );
}
