export const AUTH_STORE = Symbol('AUTH_STORE');
export const NEP413_VERIFIER = Symbol('NEP413_VERIFIER');

export type StoredAuthChallenge = {
  id: string;
  network: string;
  recipient: string;
  message: string;
  nonceHash: string;
  stateHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type SessionPrincipal = {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  wallets: Array<{ network: string; accountId: string }>;
  memberships: Array<{ organizationId: string; role: string }>;
};

export type ConsumeChallengeInput = {
  challengeId: string;
  network: string;
  nonceHash: string;
  stateHash: string;
  accountId: string;
  publicKey: string;
  sessionTokenHash: string;
  csrfTokenHash: string;
  now: Date;
  sessionExpiresAt: Date;
};

export interface AuthStore {
  createChallenge(challenge: StoredAuthChallenge): Promise<void>;
  findChallenge(id: string): Promise<StoredAuthChallenge | null>;
  consumeChallengeAndCreateSession(
    input: ConsumeChallengeInput,
  ): Promise<{ sessionId: string; userId: string } | null>;
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<SessionPrincipal | null>;
  hasActiveSessionWithCsrf(
    tokenHash: string,
    csrfTokenHash: string,
    now: Date,
  ): Promise<boolean>;
  revokeSession(
    tokenHash: string,
    csrfTokenHash: string,
    now: Date,
  ): Promise<boolean>;
}

export type Nep413Verification = {
  accountId: string;
  publicKey: string;
  signature: Uint8Array;
  message: string;
  recipient: string;
  nonce: Uint8Array;
};

export interface Nep413Verifier {
  verify(input: Nep413Verification): Promise<void>;
}
