"use client";

import { useEffect, useState } from "react";
import Privy, { LocalStorage } from "@privy-io/js-sdk-core";
import { SignPagePlugin } from "@peerfolio/privy-near-connect/sign-page-plugin";

export default function SignPage() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [client, setClient] = useState<Privy | null>(null);

  useEffect(() => {
    let active = true;
    if (appId) {
      const next = new Privy({ appId, storage: new LocalStorage() });
      void next.initialize().then(() => {
        if (active) setClient(next);
      });
    }
    return () => {
      active = false;
    };
  }, [appId]);

  if (!appId)
    return (
      <main className="auth-page">
        <p>Privy is not configured for this Coffer environment.</p>
      </main>
    );
  if (!client)
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
