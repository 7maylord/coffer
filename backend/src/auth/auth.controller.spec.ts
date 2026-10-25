import { UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { parseEnvironment } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthFailure, type AuthService } from './auth.service.js';

describe('AuthController session boundary', () => {
  const createChallenge = vi.fn();
  const completeAuth = vi.fn();
  const getSession = vi.fn();
  const logout = vi.fn();
  const setCookie = vi.fn();
  const clearCookie = vi.fn();
  const auth = {
    createNearChallenge: createChallenge,
    completeNearAuth: completeAuth,
    getSession,
    logout,
  } as unknown as AuthService;
  const response = {
    cookie: setCookie,
    clearCookie,
  } as unknown as Response;
  const controller = new AuthController(auth, parseEnvironment({}));
  const validBody = {
    challengeId: 'ed8fd884-75e5-49e0-95f2-2586aa07f6e2',
    accountId: 'alice.testnet',
    publicKey: 'ed25519:11111111111111111111111111111111',
    signature: Buffer.alloc(64, 1).toString('base64'),
    nonce: Buffer.alloc(32, 2).toString('base64'),
    state: Buffer.alloc(32, 3).toString('base64url'),
  };

  beforeEach(() => vi.clearAllMocks());

  it('returns a newly-created challenge', async () => {
    createChallenge.mockResolvedValueOnce({ challengeId: 'challenge' });
    await expect(controller.createNearChallenge()).resolves.toEqual({
      challengeId: 'challenge',
    });
  });

  it('sets separate httpOnly session and readable CSRF cookies', async () => {
    completeAuth.mockResolvedValueOnce({
      userId: 'user_1',
      sessionToken: 's'.repeat(43),
      csrfToken: 'c'.repeat(43),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(controller.verifyNear(validBody, response)).resolves.toEqual({
      userId: 'user_1',
      expiresAt: expect.any(String),
    });
    expect(setCookie).toHaveBeenNthCalledWith(
      1,
      'coffer_session',
      's'.repeat(43),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
      }),
    );
    expect(setCookie).toHaveBeenNthCalledWith(
      2,
      'coffer_csrf',
      'c'.repeat(43),
      expect.objectContaining({ httpOnly: false }),
    );
  });

  it('returns one safe unauthorized class for malformed or failed proofs', async () => {
    await expect(
      controller.verifyNear({ ...validBody, extra: true }, response),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    completeAuth.mockRejectedValueOnce(new AuthFailure('INVALID_SIGNATURE'));
    await expect(
      controller.verifyNear(validBody, response),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const unexpected = new Error('database unavailable');
    completeAuth.mockRejectedValueOnce(unexpected);
    await expect(controller.verifyNear(validBody, response)).rejects.toBe(
      unexpected,
    );
  });

  it('reads only a well-formed session cookie', async () => {
    getSession.mockResolvedValueOnce({ userId: 'user_1' });
    await expect(
      controller.session(`other=value; coffer_session=${'s'.repeat(43)}`),
    ).resolves.toEqual({ userId: 'user_1' });
    expect(getSession).toHaveBeenCalledWith('s'.repeat(43));

    await expect(controller.session(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller.session('invalid-part; coffer_session=short'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires double-submit CSRF proof and clears cookies after revocation', async () => {
    const sessionToken = 's'.repeat(43);
    const csrfToken = 'c'.repeat(43);
    const cookies = `coffer_session=${sessionToken}; coffer_csrf=${csrfToken}`;

    await expect(
      controller.logout(cookies, 'wrong', response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.logout(cookies, csrfToken, response),
    ).resolves.toEqual({ status: 'revoked' });
    expect(logout).toHaveBeenCalledWith(sessionToken, csrfToken);
    expect(clearCookie).toHaveBeenCalledTimes(2);
  });
});
