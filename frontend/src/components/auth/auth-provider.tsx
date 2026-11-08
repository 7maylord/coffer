"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  NearConnector,
  type AccountWithSignedMessage,
  type EventMap,
  type WalletManifest,
} from "@hot-labs/near-connect";
import {
  PrivyProvider,
  useLogin,
  useLogout,
  usePrivy,
  type User,
} from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import {
  ApiError,
  cofferApi,
  type CreateOrganizationInput,
  type IntentsDepositTransaction,
  type Organization,
  type SessionPrincipal,
} from "@/lib/coffer-api";
import { intentsDepositWalletRequest } from "@/lib/intents-wallet";

type AuthStatus =
  | "loading"
  | "anonymous"
  | "authenticating"
  | "authenticated"
  | "unavailable";

type PrivyAdapter = {
  authenticated: boolean;
  ready: boolean;
  user: User | null;
  login: () => void;
  logout: () => Promise<void>;
  createNearWallet: () => Promise<void>;
};

type AuthContextValue = {
  status: AuthStatus;
  session: SessionPrincipal | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  error: string;
  privyConfigured: boolean;
  privyAuthenticated: boolean;
  selectOrganization: (id: string) => void;
  signInWithWallet: () => Promise<void>;
  signInWithPrivy: () => Promise<void>;
  createOrganization: (input: CreateOrganizationInput) => Promise<void>;
  signIntentsDeposit: (
    transaction: IntentsDepositTransaction,
  ) => Promise<string>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const PRIVY_WALLET_ID = "coffer-privy";
const EXECUTOR_URL =
  "https://raw.githubusercontent.com/beneviolabs/privy-near-connect/3d56b782669d242a1ea432921e291abc26b4ebc7/executor.js";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UNAVAILABLE")
      return "Coffer could not reach its API. Check that the backend is running.";
    if (error.code === "INVALID_RESPONSE")
      return "The API returned data Coffer could not verify.";
    if (error.code === "FORBIDDEN")
      return "Your account is not allowed to perform that action.";
    if (error.code === "UNAUTHORIZED")
      return "Your session or wallet proof is no longer valid. Please sign in again.";
  }
  return "Coffer could not verify your session. Check that the API is running, then try again.";
}

function decodeNonce(value: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
  if (bytes.length !== 32) throw new Error("Invalid challenge nonce");
  return bytes;
}

function privyManifest(origin: string): WalletManifest {
  return {
    id: PRIVY_WALLET_ID,
    name: "Coffer with Privy",
    icon: `${origin}/favicon.ico`,
    description: "A Privy embedded NEAR wallet for Coffer",
    website: origin,
    version: "1.0.0",
    executor: EXECUTOR_URL,
    type: "sandbox",
    platform: ["web"],
    permissions: {
      storage: true,
      allowsOpen: [origin],
      // Privy's executor reads this extension to enable its secure popup flow.
      ...({ isPrivyConnect: true } as Record<string, boolean>),
    },
    features: {
      signMessage: true,
      signTransaction: false,
      signAndSendTransaction: true,
      signAndSendTransactions: true,
      signInWithoutAddKey: true,
      signInAndSignMessage: true,
      signInWithFunctionCallKey: false,
      signDelegateActions: false,
      mainnet: false,
      testnet: true,
    },
    ...({
      metadata: { signPageURL: `${origin}/sign`, debug: false },
    } as Record<string, unknown>),
  };
}

function AuthProviderInner({
  children,
  privy,
}: PropsWithChildren<{ privy?: PrivyAdapter }>) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<SessionPrincipal | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrganization, setCurrentOrganization] =
    useState<Organization | null>(null);
  const [error, setError] = useState("");
  const connectorRef = useRef<NearConnector | null>(null);

  const connector = useCallback(async () => {
    if (!connectorRef.current) {
      connectorRef.current = new NearConnector({
        network: "testnet",
        features: {
          signInAndSignMessage: true,
          signMessage: true,
          signAndSendTransaction: true,
          testnet: true,
        },
      });
      await connectorRef.current.whenManifestLoaded;
      if (privy)
        await connectorRef.current.registerWallet(
          privyManifest(location.origin),
        );
    }
    return connectorRef.current;
  }, [privy]);

  const applyAuthenticatedState = useCallback(
    (nextSession: SessionPrincipal, nextOrganizations: Organization[]) => {
      const selectedId = localStorage.getItem("coffer_organization_id");
      const selected =
        nextOrganizations.find(
          (organization) => organization.id === selectedId,
        ) ??
        nextOrganizations[0] ??
        null;
      if (selected) localStorage.setItem("coffer_organization_id", selected.id);
      else localStorage.removeItem("coffer_organization_id");
      setSession(nextSession);
      setOrganizations(nextOrganizations);
      setCurrentOrganization(selected);
      setStatus("authenticated");
      setError("");
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const nextSession = await cofferApi.session();
      const nextOrganizations = await cofferApi.organizations();
      applyAuthenticatedState(nextSession, nextOrganizations);
    } catch (caught) {
      setSession(null);
      setOrganizations([]);
      setCurrentOrganization(null);
      if (caught instanceof ApiError && caught.code === "UNAUTHORIZED") {
        setStatus("anonymous");
        setError("");
      } else {
        setStatus("unavailable");
        setError(errorMessage(caught));
      }
    }
  }, [applyAuthenticatedState]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === "visible" && status === "authenticated")
        void refresh();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [refresh, status]);

  const completeWalletSignIn = useCallback(
    async (walletId?: string) => {
      setStatus("authenticating");
      setError("");
      try {
        const challenge = await cofferApi.createChallenge();
        const nearConnector = await connector();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let handler:
          | ((payload: EventMap["wallet:signInAndSignMessage"]) => void)
          | undefined;
        const signed = new Promise<AccountWithSignedMessage>(
          (resolve, reject) => {
            handler = (payload) => {
              const account = payload.accounts[0];
              if (!payload.success || !account) {
                reject(new Error("Wallet did not return a signed account"));
                return;
              }
              resolve(account);
            };
            nearConnector.on("wallet:signInAndSignMessage", handler);
            timeout = setTimeout(
              () => reject(new Error("Wallet signing timed out")),
              120_000,
            );
          },
        );
        try {
          await nearConnector.connect({
            walletId,
            signMessageParams: {
              message: challenge.message,
              recipient: challenge.recipient,
              nonce: decodeNonce(challenge.nonce),
            },
          });
          const account = await signed;
          await cofferApi.verifyNear({
            challengeId: challenge.challengeId,
            accountId: account.accountId,
            publicKey: account.signedMessage.publicKey,
            signature: account.signedMessage.signature,
            nonce: challenge.nonce,
            state: challenge.state,
          });
          await refresh();
        } finally {
          if (timeout) clearTimeout(timeout);
          if (handler)
            nearConnector.off("wallet:signInAndSignMessage", handler);
        }
      } catch (caught) {
        setStatus("anonymous");
        setError(errorMessage(caught));
      }
    },
    [connector, refresh],
  );

  const signInWithPrivy = useCallback(async () => {
    if (!privy || !privy.ready) return;
    if (!privy.authenticated) {
      privy.login();
      return;
    }
    try {
      await privy.createNearWallet();
      await completeWalletSignIn(PRIVY_WALLET_ID);
    } catch (caught) {
      setStatus("anonymous");
      setError(errorMessage(caught));
    }
  }, [completeWalletSignIn, privy]);

  const createOrganization = useCallback(
    async (input: CreateOrganizationInput) => {
      setError("");
      try {
        const organization = await cofferApi.createOrganization(input);
        await refresh();
        localStorage.setItem("coffer_organization_id", organization.id);
        setCurrentOrganization(organization);
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      }
    },
    [refresh],
  );

  const signIntentsDeposit = useCallback(
    async (transaction: IntentsDepositTransaction) => {
      if (status !== "authenticated" || !session) {
        throw new Error("Coffer rejected an unsafe testnet deposit request.");
      }
      const request = intentsDepositWalletRequest(
        transaction,
        session.wallets
          .filter((wallet) => wallet.network === "testnet")
          .map((wallet) => wallet.accountId),
      );

      const nearConnector = await connector();
      const connected = await nearConnector.getConnectedWallet();
      if (
        !connected.accounts.some(
          (account) => account.accountId === transaction.signerAccountId,
        )
      ) {
        throw new Error("Connect the verified testnet wallet before signing.");
      }
      const outcome = await connected.wallet.signAndSendTransaction(request);
      const transactionHash = outcome.transaction.hash;
      if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(transactionHash)) {
        throw new Error("The wallet returned an invalid transaction hash.");
      }
      return transactionHash;
    },
    [connector, session, status],
  );

  const logout = useCallback(async () => {
    setError("");
    try {
      await cofferApi.logout();
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === "UNAUTHORIZED"))
        setError(errorMessage(caught));
    }
    const connected = await connectorRef.current
      ?.getConnectedWallet()
      .catch(() => null);
    if (connected)
      await connectorRef.current
        ?.disconnect(connected.wallet)
        .catch(() => undefined);
    if (privy?.authenticated) await privy.logout().catch(() => undefined);
    localStorage.removeItem("coffer_organization_id");
    setSession(null);
    setOrganizations([]);
    setCurrentOrganization(null);
    setStatus("anonymous");
  }, [privy]);

  const selectOrganization = useCallback(
    (id: string) => {
      const selected = organizations.find(
        (organization) => organization.id === id,
      );
      if (!selected) return;
      localStorage.setItem("coffer_organization_id", selected.id);
      setCurrentOrganization(selected);
    },
    [organizations],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      organizations,
      currentOrganization,
      error,
      privyConfigured: Boolean(privy),
      privyAuthenticated: privy?.authenticated ?? false,
      selectOrganization,
      signInWithWallet: () => completeWalletSignIn(),
      signInWithPrivy,
      createOrganization,
      signIntentsDeposit,
      logout,
      refresh,
    }),
    [
      completeWalletSignIn,
      createOrganization,
      currentOrganization,
      error,
      logout,
      organizations,
      privy,
      refresh,
      selectOrganization,
      session,
      signIntentsDeposit,
      signInWithPrivy,
      status,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function PrivyAuthProvider({ children }: PropsWithChildren) {
  const { authenticated, ready, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const adapter = useMemo<PrivyAdapter>(
    () => ({
      authenticated,
      ready,
      user,
      login,
      logout,
      createNearWallet: async () => {
        const hasNearWallet = Boolean(
          user?.linkedAccounts.some(
            (account) =>
              account.type === "wallet" && account.chainType === "near",
          ),
        );
        if (!hasNearWallet) await createWallet({ chainType: "near" });
      },
    }),
    [authenticated, createWallet, login, logout, ready, user],
  );
  return <AuthProviderInner privy={adapter}>{children}</AuthProviderInner>;
}

export function AuthProviders({ children }: PropsWithChildren) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <AuthProviderInner>{children}</AuthProviderInner>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google", "github"],
        appearance: { theme: "light", accentColor: "#171916" },
      }}
    >
      <PrivyAuthProvider>{children}</PrivyAuthProvider>
    </PrivyProvider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProviders");
  return context;
}
