"use client";

import { useEffect, useMemo, useState } from "react";
import Privy, { LocalStorage } from "@privy-io/js-sdk-core";
import { SignPagePlugin } from "@peerfolio/privy-near-connect/sign-page-plugin";

export default function SignPage() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_APP_CLIENT_ID;
  const [ready, setReady] = useState(false);
  const client = useMemo(
    () =>
      appId && clientId
        ? new Privy({ appId, clientId, storage: new LocalStorage() })
        : null,
    [appId, clientId],
  );

  useEffect(() => {
    let active = true;
    if (client)
      void client.initialize().then(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [client]);

  if (!client)
    return (
      <main className="auth-page">
        <p>Privy is not configured for this Coffer environment.</p>
      </main>
    );
  if (!ready)
    return (
      <main className="auth-page" aria-busy="true">
        <p>Preparing the secure signing window…</p>
      </main>
    );
  return (
    <SignPagePlugin
      privy={client}
      options={{ allowedOrigins: [window.location.origin], debug: false }}
      theme={{ accentColor: "gray", grayColor: "sage", radius: "large" }}
    />
  );
}
