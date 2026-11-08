"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { Icon } from "@/components/coffer/icon";

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
  if (!currentOrganization || !session) return null;

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
      <section className="panel settings-panel">
        <div className="setting-readonly">
          <span>Name</span>
          <strong>{currentOrganization.name}</strong>
        </div>
        <div className="setting-readonly">
          <span>URL key</span>
          <strong>{currentOrganization.slug}</strong>
        </div>
        <div className="setting-readonly">
          <span>NEAR account</span>
          <strong>{session.wallets[0]?.accountId ?? "—"}</strong>
        </div>
        <div className="setting-readonly">
          <span>Role</span>
          <strong>{currentOrganization.role.replaceAll("_", " ")}</strong>
        </div>
        <p className="quiet-note">
          Sample workspace preferences and reset controls are kept separate from
          authenticated settings.
        </p>
      </section>
    </>
  );
}
