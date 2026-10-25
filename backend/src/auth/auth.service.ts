import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  AUTH_STORE,
  NEP413_VERIFIER,
  type AuthStore,
  type Nep413Verifier,
  type SessionPrincipal,
  type StoredAuthChallenge,
} from './auth.types.js';

const challengeLifetimeMilliseconds = 5 * 60 * 1000;
const sessionLifetimeMilliseconds = 8 * 60 * 60 * 1000;

export type CompleteNearAuthInput = {
  challengeId: string;
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  state: string;
};

export class AuthFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AuthFailure';
  }
}

const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function decodeBase64(value: string, maximumBytes: number): Uint8Array {
  if (
    value.length === 0 ||
    value.length > maximumBytes * 2 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new AuthFailure('INVALID_ENCODING');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximumBytes || bytes.toString('base64') !== value) {
    throw new AuthFailure('INVALID_ENCODING');
  }
  return bytes;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(NEP413_VERIFIER) private readonly verifier: Nep413Verifier,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async createNearChallenge(now = new Date()) {
    const id = randomUUID();
    const nonce = randomBytes(32);
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + challengeLifetimeMilliseconds);
    const recipient = new URL(this.environment.WEB_URL).origin;
    const message = [
      'Sign in to Coffer',
      `Network: ${this.environment.NEAR_NETWORK}`,
      `Challenge: ${id}`,
      `Expires: ${expiresAt.toISOString()}`,
    ].join('\n');
    const challenge: StoredAuthChallenge = {
      id,
      network: this.environment.NEAR_NETWORK,
      recipient,
      message,
      nonceHash: digest(nonce),
      stateHash: digest(state),
      expiresAt,
      consumedAt: null,
    };
    await this.store.createChallenge(challenge);
    return {
      challengeId: id,
      network: challenge.network,
      message,
      recipient,
      nonce: nonce.toString('base64'),
      state,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async completeNearAuth(input: CompleteNearAuthInput, now = new Date()) {
    const challenge = await this.store.findChallenge(input.challengeId);
    if (!challenge) throw new AuthFailure('CHALLENGE_NOT_FOUND');
    if (challenge.consumedAt) throw new AuthFailure('CHALLENGE_REPLAYED');
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      throw new AuthFailure('CHALLENGE_EXPIRED');
    }
    if (challenge.network !== this.environment.NEAR_NETWORK) {
      throw new AuthFailure('WRONG_NETWORK');
    }

    const nonce = decodeBase64(input.nonce, 32);
    const signature = decodeBase64(input.signature, 4096);
    if (
      nonce.length !== 32 ||
      !sameDigest(challenge.nonceHash, digest(nonce)) ||
      !sameDigest(challenge.stateHash, digest(input.state))
    ) {
      throw new AuthFailure('INVALID_CHALLENGE');
    }

    try {
      await this.verifier.verify({
        accountId: input.accountId,
        publicKey: input.publicKey,
        signature,
        message: challenge.message,
        recipient: challenge.recipient,
        nonce,
      });
    } catch {
      throw new AuthFailure('INVALID_SIGNATURE');
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const sessionExpiresAt = new Date(
      now.getTime() + sessionLifetimeMilliseconds,
    );
    const consumed = await this.store.consumeChallengeAndCreateSession({
      challengeId: challenge.id,
      network: challenge.network,
      nonceHash: challenge.nonceHash,
      stateHash: challenge.stateHash,
      accountId: input.accountId,
      publicKey: input.publicKey,
      sessionTokenHash: digest(sessionToken),
      csrfTokenHash: digest(csrfToken),
      now,
      sessionExpiresAt,
    });
    if (!consumed) throw new AuthFailure('CHALLENGE_REPLAYED');

    return {
      userId: consumed.userId,
      sessionToken,
      csrfToken,
      expiresAt: sessionExpiresAt.toISOString(),
    };
  }

  async getSession(
    sessionToken: string,
    now = new Date(),
  ): Promise<SessionPrincipal> {
    const session = await this.store.findActiveSession(
      digest(sessionToken),
      now,
    );
    if (!session) throw new UnauthorizedException();
    return session;
  }

  async logout(sessionToken: string, csrfToken: string, now = new Date()) {
    const revoked = await this.store.revokeSession(
      digest(sessionToken),
      digest(csrfToken),
      now,
    );
    if (!revoked) throw new UnauthorizedException();
  }

  async validateCsrf(
    sessionToken: string,
    csrfToken: string,
    now = new Date(),
  ): Promise<void> {
    const valid = await this.store.hasActiveSessionWithCsrf(
      digest(sessionToken),
      digest(csrfToken),
      now,
    );
    if (!valid) throw new UnauthorizedException();
  }
}
