import { parseEnvironment } from '../config/env.js';
import type { Mock } from 'vitest';
import { AuthFailure, AuthService } from './auth.service.js';
import type {
  AuthStore,
  Nep413Verifier,
  StoredAuthChallenge,
} from './auth.types.js';

describe('AuthService NEP-413 boundary', () => {
  let storedChallenge: StoredAuthChallenge | null;
  let store: AuthStore;
  let verifier: Nep413Verifier;
  let service: AuthService;
  let verifyProof: Mock<Nep413Verifier['verify']>;
  let consumeChallenge: Mock<AuthStore['consumeChallengeAndCreateSession']>;
  let revokeSession: Mock<AuthStore['revokeSession']>;
  let findChallenge: Mock<AuthStore['findChallenge']>;
  let findActiveSession: Mock<AuthStore['findActiveSession']>;
  let hasActiveSessionWithCsrf: Mock<AuthStore['hasActiveSessionWithCsrf']>;

  beforeEach(() => {
    storedChallenge = null;
    consumeChallenge = vi.fn<AuthStore['consumeChallengeAndCreateSession']>(
      async () => ({ sessionId: 'session_1', userId: 'user_1' }),
    );
    revokeSession = vi.fn<AuthStore['revokeSession']>();
    findChallenge = vi.fn<AuthStore['findChallenge']>(
      async () => storedChallenge,
    );
    findActiveSession = vi.fn<AuthStore['findActiveSession']>();
    hasActiveSessionWithCsrf = vi.fn<AuthStore['hasActiveSessionWithCsrf']>();
    store = {
      createChallenge: vi.fn(async (challenge) => {
        storedChallenge = challenge;
      }),
      findChallenge,
      consumeChallengeAndCreateSession: consumeChallenge,
      findActiveSession,
      hasActiveSessionWithCsrf,
      revokeSession,
    };
    verifyProof = vi
      .fn<Nep413Verifier['verify']>()
      .mockResolvedValue(undefined);
    verifier = { verify: verifyProof };
    service = new AuthService(store, verifier, parseEnvironment({}));
  });

  async function challengeInput(now = new Date('2026-10-29T10:00:00.000Z')) {
    const challenge = await service.createNearChallenge(now);
    return {
      challengeId: challenge.challengeId,
      accountId: 'alice.testnet',
      publicKey: 'ed25519:11111111111111111111111111111111',
      signature: Buffer.alloc(64, 1).toString('base64'),
      nonce: challenge.nonce,
      state: challenge.state,
    };
  }

  it('creates a domain, network, expiry, state, and 32-byte nonce bound challenge', async () => {
    const now = new Date('2026-10-29T10:00:00.000Z');
    const challenge = await service.createNearChallenge(now);

    expect(Buffer.from(challenge.nonce, 'base64')).toHaveLength(32);
    expect(challenge).toMatchObject({
      network: 'testnet',
      recipient: 'http://localhost:3000',
      expiresAt: '2026-10-29T10:05:00.000Z',
    });
    expect(challenge.message).toContain('Network: testnet');
    expect(challenge.message).toContain(`Challenge: ${challenge.challengeId}`);
    expect(storedChallenge).toMatchObject({
      nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      stateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(storedChallenge)).not.toContain(challenge.nonce);
    expect(JSON.stringify(storedChallenge)).not.toContain(challenge.state);
  });

  it('verifies the exact NEP-413 payload and atomically consumes the challenge', async () => {
    const now = new Date('2026-10-29T10:00:00.000Z');
    const input = await challengeInput(now);
    const result = await service.completeNearAuth(
      input,
      new Date('2026-10-29T10:01:00.000Z'),
    );

    expect(verifyProof).toHaveBeenCalledWith({
      accountId: input.accountId,
      publicKey: input.publicKey,
      signature: Buffer.from(input.signature, 'base64'),
      message: storedChallenge?.message,
      recipient: storedChallenge?.recipient,
      nonce: Buffer.from(input.nonce, 'base64'),
    });
    expect(consumeChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: input.challengeId,
        accountId: 'alice.testnet',
        sessionTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        csrfTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(result).toMatchObject({
      userId: 'user_1',
      expiresAt: '2026-10-29T18:01:00.000Z',
    });
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('T-ID-01 rejects already-consumed and atomically-lost challenge replays', async () => {
    const input = await challengeInput();
    storedChallenge = {
      ...storedChallenge!,
      consumedAt: new Date('2026-10-29T10:01:00.000Z'),
    };
    await expect(service.completeNearAuth(input)).rejects.toMatchObject({
      code: 'CHALLENGE_REPLAYED',
    });

    storedChallenge = { ...storedChallenge, consumedAt: null };
    consumeChallenge.mockResolvedValueOnce(null);
    await expect(
      service.completeNearAuth(input, new Date('2026-10-29T10:01:00.000Z')),
    ).rejects.toMatchObject({ code: 'CHALLENGE_REPLAYED' });
  });

  it('T-ID-02 rejects an expired nonce before signature verification', async () => {
    const input = await challengeInput();
    await expect(
      service.completeNearAuth(input, new Date('2026-10-29T10:05:00.000Z')),
    ).rejects.toMatchObject({ code: 'CHALLENGE_EXPIRED' });
    expect(verifyProof).not.toHaveBeenCalled();
  });

  it('T-ID-03 rejects wrong state, malformed encodings, and signer failures', async () => {
    const input = await challengeInput();
    await expect(
      service.completeNearAuth(
        { ...input, state: 'x'.repeat(43) },
        new Date('2026-10-29T10:01:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(AuthFailure);

    await expect(
      service.completeNearAuth(
        { ...input, nonce: 'not-base64' },
        new Date('2026-10-29T10:01:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ENCODING' });

    verifyProof.mockRejectedValueOnce(new Error('wrong signer'));
    await expect(
      service.completeNearAuth(input, new Date('2026-10-29T10:01:00.000Z')),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('T-ID-08 requires matching session and CSRF hashes for logout', async () => {
    revokeSession.mockResolvedValueOnce(true);
    await service.logout('session-token', 'csrf-token');
    expect(revokeSession).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );

    revokeSession.mockResolvedValueOnce(false);
    await expect(service.logout('bad', 'bad')).rejects.toThrow('Unauthorized');
  });

  it('validates CSRF against the active server-side session', async () => {
    hasActiveSessionWithCsrf.mockResolvedValueOnce(true);
    await expect(
      service.validateCsrf('session', 'csrf'),
    ).resolves.toBeUndefined();
    expect(hasActiveSessionWithCsrf).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );
    hasActiveSessionWithCsrf.mockResolvedValueOnce(false);
    await expect(service.validateCsrf('session', 'wrong')).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('returns only active sessions and rejects missing ones', async () => {
    const principal = {
      sessionId: 'session_1',
      userId: 'user_1',
      expiresAt: new Date('2026-10-29T18:00:00.000Z'),
      wallets: [],
      memberships: [],
    };
    findActiveSession.mockResolvedValueOnce(principal);
    await expect(service.getSession('token')).resolves.toBe(principal);
    findActiveSession.mockResolvedValueOnce(null);
    await expect(service.getSession('missing')).rejects.toThrow('Unauthorized');
  });

  it('rejects unknown challenges and network-boundary mismatches', async () => {
    findChallenge.mockResolvedValueOnce(null);
    await expect(
      service.completeNearAuth({
        challengeId: 'missing',
        accountId: 'alice.testnet',
        publicKey: 'key',
        signature: Buffer.alloc(64).toString('base64'),
        nonce: Buffer.alloc(32).toString('base64'),
        state: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });

    const input = await challengeInput();
    storedChallenge = { ...storedChallenge!, network: 'mainnet' };
    await expect(
      service.completeNearAuth(input, new Date('2026-10-29T10:01:00.000Z')),
    ).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
  });
});
