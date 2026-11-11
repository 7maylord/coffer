"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";
import {
  ApiError,
  cofferApi,
  type OrganizationInvite,
  type OrganizationMember,
} from "@/lib/coffer-api";
import { invitationUrl } from "@/lib/invitation";
import { StateToast } from "@/components/ui/state-toast";
import { toast } from "sonner";

export function AuthenticatedOverview() {
  const { currentOrganization, session } = useAuth();
  if (!currentOrganization || !session) return null;
  const accountId = session.wallets[0]?.accountId ?? "NEAR account";

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">SECURE · AUTHENTICATED WORKSPACE</span>
          <h1>
            {currentOrganization.name} is <em>ready.</em>
          </h1>
          <p>
            This workspace is backed by your Coffer API. Sample records stay
            isolated in the public preview and are never loaded here.
          </p>
        </div>
        <div className="page-actions">
          <Link className="button dark" href="/invoices">
            <Icon name="plus" size={17} /> Create an invoice
          </Link>
        </div>
      </header>

      <div className="stats-row">
        <article className="stat-card">
          <div>
            <span>Verified identity</span>
            <Icon name="shield" size={17} />
          </div>
          <strong>{accountId}</strong>
          <small>Wallet challenge authenticated</small>
        </article>
        <article className="stat-card">
          <div>
            <span>Workspace URL key</span>
            <Icon name="northeast" size={17} />
          </div>
          <strong>{currentOrganization.slug}</strong>
          <small>Tenant-scoped backend records</small>
        </article>
        <article className="stat-card">
          <div>
            <span>Your role</span>
            <Icon name="people" size={17} />
          </div>
          <strong>{currentOrganization.role.replaceAll("_", " ")}</strong>
          <small>Server-enforced permissions</small>
        </article>
      </div>

      <section className="panel empty-state">
        <span className="eyebrow">A CLEAN START</span>
        <h2>No sample financial records were added.</h2>
        <p>
          Create an invoice, inspect available assets in Treasury, or review the
          audit trail. Any transfer remains separately reviewed and approved in
          your wallet.
        </p>
        <div className="page-actions">
          <Link className="button light" href="/treasury">
            Open treasury <Icon name="arrow" size={16} />
          </Link>
          <Link className="text-link" href="/activity">
            View activity <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>
    </>
  );
}

export function AuthenticatedSettings() {
  const { currentOrganization, session } = useAuth();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [accountId, setAccountId] = useState("");
  const [invite, setInvite] = useState<OrganizationInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const organizationId = currentOrganization?.id;
  const loadMembers = useCallback(async () => {
    if (!organizationId) return;
    try {
      setMembers(await cofferApi.organizationMembers(organizationId));
    } catch {
      setMessage("Coffer could not load workspace members.");
    }
  }, [organizationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMembers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMembers]);

  if (!currentOrganization || !session) return null;

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setInvite(null);
    setMessage("");
    try {
      setInvite(
        await cofferApi.inviteEmployee(
          currentOrganization.id,
          accountId.trim().toLowerCase(),
        ),
      );
      setAccountId("");
    } catch (caught) {
      setMessage(
        caught instanceof ApiError && caught.code === "FORBIDDEN"
          ? "Only the workspace owner can invite employees."
          : "Coffer could not create this invitation. Check the account ID and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (member: OrganizationMember) => {
    if (!window.confirm(`Remove ${member.displayName} from this workspace?`))
      return;
    setMessage("");
    try {
      await cofferApi.revokeOrganizationMember(
        currentOrganization.id,
        member.userId,
      );
      await loadMembers();
      toast.success(`${member.displayName} was removed from the workspace.`);
    } catch {
      setMessage("Coffer could not remove that member.");
    }
  };

  const link =
    invite && typeof window !== "undefined"
      ? invitationUrl(window.location.origin, invite.token)
      : "";

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">AUTHENTICATED WORKSPACE</span>
          <h1>
            Workspace <em>identity.</em>
          </h1>
          <p>These values come from your verified tenant membership.</p>
        </div>
      </header>
      <section
        className="panel organization-profile"
        aria-label="Workspace details"
      >
        <div className="organization-profile-heading">
          <span className="eyebrow">WORKSPACE PROFILE</span>
          <span className="verified-membership">
            <i aria-hidden="true" /> Verified membership
          </span>
        </div>
        <dl className="organization-details">
          <div>
            <dt>Name</dt>
            <dd>{currentOrganization.name}</dd>
          </div>
          <div>
            <dt>URL key</dt>
            <dd>{currentOrganization.slug}</dd>
          </div>
          <div>
            <dt>NEAR account</dt>
            <dd>{session.wallets[0]?.accountId ?? "—"}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>
              <span className="organization-role">
                {currentOrganization.role.replaceAll("_", " ")}
              </span>
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel settings-panel member-panel">
        <span className="eyebrow">TEAM ACCESS</span>
        <h2>Invite an employee</h2>
        <p>
          Enter the employee&apos;s exact NEAR account. The single-use link
          expires after 24 hours and cannot be accepted by another wallet.
        </p>
        <form
          className="form-stack"
          onSubmit={(event) => void createInvite(event)}
        >
          <label>
            Employee NEAR account
            <input
              required
              minLength={2}
              maxLength={64}
              pattern="[a-z0-9]+(?:[._-][a-z0-9]+)*"
              placeholder="employee.testnet"
              autoComplete="off"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            />
          </label>
          <button className="button dark" disabled={busy}>
            {busy ? "Creating invitation…" : "Create invitation"}
          </button>
        </form>
        <StateToast id="settings-error" message={message} />
        {invite && (
          <div className="invite-result" aria-live="polite">
            <strong>Invitation ready</strong>
            <p>Send this link only to {invite.targetNearAccountId}.</p>
            <input
              readOnly
              value={link}
              aria-label="Employee invitation link"
            />
            <button
              className="button light"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => toast.success("Invitation link copied."))
                  .catch(() =>
                    toast.error("Could not copy the invitation link."),
                  )
              }
            >
              Copy invitation link
            </button>
            <small>Expires {new Date(invite.expiresAt).toLocaleString()}</small>
          </div>
        )}
        <div className="member-list">
          <h3>Workspace members</h3>
          {members.map((member) => (
            <div className="member-row" key={member.userId}>
              <div>
                <strong>{member.displayName}</strong>
                <small>
                  {member.wallets[0]?.accountId ?? "No wallet"} ·{" "}
                  {member.role.replaceAll("_", " ")}
                </small>
              </div>
              {member.role !== "OWNER" && (
                <button
                  className="text-link"
                  onClick={() => void revoke(member)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
