"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  ApiError,
  cofferApi,
  type PolicyContractDeployment,
  type SponsoredPolicyDeployment,
} from "@/lib/coffer-api";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CONFLICT")
      return "The policy instance changed. Refresh its chain status.";
    if (error.code === "FORBIDDEN")
      return "A verified owner wallet and distinct eligible approvers are required.";
    if (error.code === "UNAVAILABLE")
      return "The factory could not be verified at a final block.";
    if (error.code === "INVALID_RESPONSE")
      return "Coffer rejected an unverifiable factory response.";
  }
  return "The policy contract request could not be completed.";
}

export function PolicyContractDeployment({
  organizationId,
}: {
  organizationId: string;
}) {
  const { session } = useAuth();
  const [deployment, setDeployment] = useState<PolicyContractDeployment | null>(
    null,
  );
  const [preview, setPreview] = useState<SponsoredPolicyDeployment | null>(
    null,
  );
  const [controller, setController] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await cofferApi.policyContractDeployment(organizationId);
      setDeployment(next);
      const owner = next.eligibleApprovers.find(
        (candidate) =>
          candidate.role === "OWNER" &&
          session?.wallets.some(
            (wallet) =>
              wallet.network === "testnet" &&
              wallet.accountId === candidate.accountId,
          ),
      );
      setController(owner?.accountId ?? "");
      const distinctHumans = new Set<string>();
      const candidates = owner
        ? [
            owner,
            ...next.eligibleApprovers.filter(
              ({ accountId }) => accountId !== owner.accountId,
            ),
          ]
        : next.eligibleApprovers;
      setApprovers(
        candidates
          .filter(({ userId }) => {
            if (distinctHumans.has(userId)) return false;
            distinctHumans.add(userId);
            return true;
          })
          .slice(0, next.approvalThreshold)
          .map(({ accountId }) => accountId),
      );
      if (next.deploymentStatus !== "READY") setPreview(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [organizationId, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedHumans = useMemo(
    () =>
      new Set(
        deployment?.eligibleApprovers
          .filter(({ accountId }) => approvers.includes(accountId))
          .map(({ userId }) => userId),
      ).size,
    [approvers, deployment],
  );

  const toggleApprover = (accountId: string, userId: string) => {
    setApprovers((current) => {
      if (current.includes(accountId))
        return current.filter((account) => account !== accountId);
      const sameHuman = new Set(
        deployment?.eligibleApprovers
          .filter((candidate) => candidate.userId === userId)
          .map((candidate) => candidate.accountId),
      );
      return [
        ...current.filter((account) => !sameHuman.has(account)),
        accountId,
      ];
    });
  };

  const prepare = async () => {
    if (!controller) return;
    setBusy(true);
    setError("");
    try {
      setPreview(
        await cofferApi.previewPolicyContractDeployment(organizationId, {
          controller,
          approvers,
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const bind = async () => {
    setBusy(true);
    setError("");
    try {
      await cofferApi.bindPolicyContract(organizationId);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel policy-contract-deployment" aria-busy={loading}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PER-BUSINESS POLICY INSTANCE</span>
          <h2>Policy contract</h2>
        </div>
        <span className="api-mode">TESTNET</span>
      </div>

      {loading && !deployment ? (
        <p className="api-empty">Verifying the factory at a final block…</p>
      ) : deployment ? (
        <div className="policy-contract-body">
          <p>
            <span
              className={`api-status is-${deployment.deploymentStatus.toLowerCase()}`}
            >
              {deployment.deploymentStatus}
            </span>{" "}
            {deployment.expectedInstanceAccountId}
          </p>

          {deployment.deploymentStatus === "READY" && !preview && (
            <div className="form-stack">
              <label>
                Owner controller
                <select
                  value={controller}
                  onChange={(event) => setController(event.target.value)}
                >
                  {deployment.eligibleApprovers
                    .filter(
                      ({ role, accountId }) =>
                        role === "OWNER" &&
                        session?.wallets.some(
                          (wallet) =>
                            wallet.network === "testnet" &&
                            wallet.accountId === accountId,
                        ),
                    )
                    .map(({ accountId }) => (
                      <option key={accountId} value={accountId}>
                        {accountId}
                      </option>
                    ))}
                </select>
              </label>
              <fieldset>
                <legend>
                  Distinct approvers · {selectedHumans} /{" "}
                  {deployment.approvalThreshold}
                </legend>
                {deployment.eligibleApprovers.map((candidate) => (
                  <label
                    key={candidate.accountId}
                    className="policy-approver-option"
                  >
                    <input
                      type="checkbox"
                      checked={approvers.includes(candidate.accountId)}
                      onChange={() =>
                        toggleApprover(candidate.accountId, candidate.userId)
                      }
                    />
                    {candidate.accountId} · {candidate.role}
                  </label>
                ))}
              </fieldset>
              <button
                className="button dark"
                disabled={
                  busy ||
                  !approvers.includes(controller) ||
                  selectedHumans < deployment.approvalThreshold
                }
                onClick={() => void prepare()}
              >
                Prepare sponsored deployment
              </button>
            </div>
          )}

          {preview && deployment.deploymentStatus === "READY" && (
            <div className="policy-operator-call">
              <strong>Operator action required</strong>
              <p>
                {preview.signerId} signs the exact call and funds{" "}
                {preview.depositYocto} yoctoNEAR. The browser never receives its
                key.
              </p>
              <button
                className="button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    JSON.stringify(preview, null, 2),
                  )
                }
              >
                Copy operator payload
              </button>
            </div>
          )}

          {deployment.deploymentStatus === "PENDING" && (
            <p>
              The factory callback is pending. Do not submit a duplicate call.
            </p>
          )}
          {deployment.deploymentStatus === "ACTIVE" && (
            <button
              className="button dark"
              disabled={busy}
              onClick={() => void bind()}
            >
              Verify and bind instance
            </button>
          )}
          {deployment.deploymentStatus === "BOUND" && deployment.binding && (
            <p>
              Verified code hash{" "}
              {deployment.binding.expectedCodeHash.slice(0, 10)}… ·{" "}
              <a
                href={`https://testnet.nearblocks.io/address/${deployment.binding.contractAccountId}`}
                target="_blank"
                rel="noreferrer"
              >
                View in explorer
              </a>
            </p>
          )}
          {deployment.deploymentStatus !== "BOUND" && (
            <button
              className="button"
              disabled={loading || busy}
              onClick={() => void load()}
            >
              Refresh chain status
            </button>
          )}
        </div>
      ) : null}

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
