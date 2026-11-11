"use client";

import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { Workspace } from "@/components/coffer/workspace";
import { Icon, Mark } from "@/components/coffer/icon";
import { pages, type PageId } from "@/lib/demo";
import { canAccessPage } from "@/lib/workspace-access";
import { invitationToken } from "@/lib/invitation";
import { StateToast } from "@/components/ui/state-toast";
import { toast } from "sonner";

function AuthFrame({ children }: PropsWithChildren) {
  return (
    <main className="auth-page">
      <Link className="brand" href="/" aria-label="Coffer home">
        <Mark /> coffer.
      </Link>
      <section className="auth-card">{children}</section>
    </main>
  );
}

function SignIn() {
  const {
    status,
    error,
    privyConfigured,
    privyAuthenticated,
    signInWithWallet,
    signInWithPrivy,
    refresh,
  } = useAuth();
  const busy = status === "authenticating";
  return (
    <AuthFrame>
      <span className="eyebrow">NEAR TESTNET · VERIFIED ACCESS</span>
      <h1>Step into your coffer.</h1>
      <p>
        Your wallet signs a one-time NEP-413 message. It does not send a
        transaction, add an access key, or move funds.
      </p>
      <StateToast id="sign-in-error" message={error} />
      <div className="auth-actions">
        <button
          className="button dark"
          disabled={busy}
          onClick={() => void signInWithWallet()}
        >
          <Icon name="shield" />
          {busy ? "Waiting for your wallet…" : "Continue with a NEAR wallet"}
        </button>
        {privyConfigured ? (
          <button
            className="button light"
            disabled={busy}
            onClick={() => void signInWithPrivy()}
          >
            <Icon name="spark" />
            {privyAuthenticated
              ? "Sign NEAR challenge with Privy"
              : "Continue with Privy"}
          </button>
        ) : (
          <p className="auth-note">
            Privy social login is available when its public App ID is
            configured.
          </p>
        )}
      </div>
      {status === "unavailable" && (
        <button className="text-link" onClick={() => void refresh()}>
          Try the API again <Icon name="arrow" size={16} />
        </button>
      )}
      <Link className="text-link" href="/demo/overview">
        Explore the no-wallet demo <Icon name="arrow" size={16} />
      </Link>
    </AuthFrame>
  );
}

function OrganizationSetup() {
  const { createOrganization, error, logout, session } = useAuth();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await createOrganization({ name: name.trim(), slug });
    } catch {
      // The auth provider owns the user-facing API error state.
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame>
      <span className="eyebrow">ONE LAST DETAIL</span>
      <h1>Name your workspace.</h1>
      <p>
        Signed in as <strong>{session?.wallets[0]?.accountId}</strong>. Your
        first workspace makes you its owner.
      </p>
      <StateToast id="workspace-setup-error" message={error} />
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label>
          Workspace name
          <input
            required
            minLength={1}
            maxLength={100}
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              setSlug(
                next
                  .toLowerCase()
                  .trim()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 48),
              );
            }}
          />
        </label>
        <label>
          Workspace URL key
          <input
            required
            minLength={3}
            maxLength={48}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </label>
        <button className="button dark" disabled={busy}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </form>
      <button className="text-link" onClick={() => void logout()}>
        Sign out
      </button>
    </AuthFrame>
  );
}

function InvitationAcceptance({
  token,
  clear,
}: {
  token: string;
  clear: () => void;
}) {
  const { acceptInvitation, error, logout, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const accept = async () => {
    setBusy(true);
    setFailure("");
    try {
      await acceptInvitation(token);
      clear();
      toast.success("Workspace joined.");
    } catch {
      setFailure(
        "This invitation could not be accepted. It may have expired, already been used, or belong to another NEAR account.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <span className="eyebrow">WORKSPACE INVITATION</span>
      <h1>Join your team.</h1>
      <p>
        Signed in as <strong>{session?.wallets[0]?.accountId}</strong>. The
        invitation will only work for the NEAR account selected by its owner.
      </p>
      <StateToast id="invitation-error" message={failure || error} />
      <div className="auth-actions">
        <button className="button dark" disabled={busy} onClick={accept}>
          {busy ? "Joining workspace…" : "Accept invitation"}
        </button>
        <button className="button light" disabled={busy} onClick={clear}>
          Not now
        </button>
      </div>
      <button className="text-link" onClick={() => void logout()}>
        Sign in with another account
      </button>
    </AuthFrame>
  );
}

export function AuthenticatedWorkspace({ children }: PropsWithChildren) {
  const { status, session, currentOrganization, logout } = useAuth();
  const pathname = usePathname();
  const [invite, setInvite] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setInvite(invitationToken(window.location.hash) ?? ""),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  const clearInvite = () => {
    window.history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}`,
    );
    setInvite("");
  };
  const page = pages.find((candidate) => pathname === `/${candidate.id}`);
  const visiblePages = useMemo(
    () =>
      new Set<PageId>(
        currentOrganization
          ? pages
              .filter((candidate) =>
                canAccessPage(currentOrganization.role, candidate.id),
              )
              .map((candidate) => candidate.id)
          : [],
      ),
    [currentOrganization],
  );

  if (status === "loading")
    return (
      <AuthFrame>
        <p aria-busy="true">Checking your Coffer session…</p>
      </AuthFrame>
    );
  if (status !== "authenticated" || !session) return <SignIn />;
  if (invite)
    return <InvitationAcceptance token={invite} clear={clearInvite} />;
  if (!currentOrganization) return <OrganizationSetup />;
  if (page && !canAccessPage(currentOrganization.role, page.id))
    return (
      <AuthFrame>
        <span className="eyebrow">ACCESS BOUNDARY</span>
        <h1>This page is outside your role.</h1>
        <p>
          Your <strong>{currentOrganization.role.toLowerCase()}</strong> role
          does not include this workspace area. The API enforces authorization
          independently of this screen.
        </p>
        <Link
          className="button dark"
          href={`/${[...visiblePages][0] ?? "overview"}`}
        >
          Go to an available page
        </Link>
      </AuthFrame>
    );

  return (
    <Workspace
      mode="authenticated"
      organizationName={currentOrganization.name}
      accountId={session.wallets[0]?.accountId ?? "NEAR account"}
      role={currentOrganization.role}
      visiblePages={visiblePages}
      onLogout={() => void logout()}
    >
      {children}
    </Workspace>
  );
}
