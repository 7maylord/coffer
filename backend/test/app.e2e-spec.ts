import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { HealthDependencies } from '../src/health/health.service.js';
import { safeLogger } from '../src/http/safe-logger.js';
import {
  AUTH_STORE,
  NEP413_VERIFIER,
  type AuthStore,
  type StoredAuthChallenge,
} from '../src/auth/auth.types.js';
import { SETTLEMENT_OPERATIONS } from '../src/settlement/settlement.store.js';
import { MockSettlementAdapter } from '../src/settlement/mock-settlement.adapter.js';

class E2eAuthStore implements AuthStore {
  challenge: StoredAuthChallenge | null = null;
  sessions = new Map<string, { csrf: string; revoked: boolean }>();
  role = 'OWNER';

  seedSession(token: string, csrfToken: string) {
    this.sessions.set(createHash('sha256').update(token).digest('hex'), {
      csrf: createHash('sha256').update(csrfToken).digest('hex'),
      revoked: false,
    });
  }

  async createChallenge(challenge: StoredAuthChallenge) {
    this.challenge = challenge;
  }

  async findChallenge(id: string) {
    return this.challenge?.id === id ? this.challenge : null;
  }

  async consumeChallengeAndCreateSession(
    input: Parameters<AuthStore['consumeChallengeAndCreateSession']>[0],
  ) {
    if (!this.challenge || this.challenge.consumedAt) return null;
    this.challenge.consumedAt = input.now;
    this.sessions.set(input.sessionTokenHash, {
      csrf: input.csrfTokenHash,
      revoked: false,
    });
    return { sessionId: 'session_1', userId: 'user_1' };
  }

  async findActiveSession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revoked) return null;
    return {
      sessionId: 'session_1',
      userId: 'user_1',
      expiresAt: new Date(now.getTime() + 1000),
      wallets: [{ network: 'testnet', accountId: 'alice.testnet' }],
      memberships: [{ organizationId: 'org_demo', role: this.role }],
    };
  }

  async revokeSession(tokenHash: string, csrfTokenHash: string) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revoked || session.csrf !== csrfTokenHash)
      return false;
    session.revoked = true;
    return true;
  }

  async hasActiveSessionWithCsrf(tokenHash: string, csrfTokenHash: string) {
    const session = this.sessions.get(tokenHash);
    return !!session && !session.revoked && session.csrf === csrfTokenHash;
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const dependencies = { postgres: vi.fn(), redis: vi.fn() };
  let authStore: E2eAuthStore;
  const sessionToken = 'e'.repeat(43);
  const csrfToken = 'c'.repeat(43);
  const authenticatedCookie = `coffer_session=${sessionToken}; coffer_csrf=${csrfToken}`;

  beforeEach(async () => {
    dependencies.postgres.mockResolvedValue(undefined);
    dependencies.redis.mockResolvedValue(undefined);
    authStore = new E2eAuthStore();
    authStore.seedSession(sessionToken, csrfToken);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HealthDependencies)
      .useValue(dependencies)
      .overrideProvider(AUTH_STORE)
      .useValue(authStore)
      .overrideProvider(NEP413_VERIFIER)
      .useValue({ verify: vi.fn().mockResolvedValue(undefined) })
      .overrideProvider(SETTLEMENT_OPERATIONS)
      .useValue(new MockSettlementAdapter())
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('keeps liveness healthy during dependency failure and recovers readiness', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    dependencies.redis.mockRejectedValue(new Error('secret-service-url'));
    const unavailable = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(unavailable.body.error.code).toBe('HTTP_503');
    expect(JSON.stringify(unavailable.body)).not.toContain(
      'secret-service-url',
    );
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    dependencies.redis.mockResolvedValue(undefined);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });

  it('records only safe metadata for a request containing secrets', async () => {
    const logs = vi.spyOn(safeLogger, 'write');
    try {
      const response = await request(app.getHttpServer())
        .post('/v1/orgs/org_demo/payments/quotes?token=secret-query')
        .set('Authorization', 'Bearer secret-authorization')
        .set('Cookie', `${authenticatedCookie}; session=secret-cookie`)
        .set('X-CSRF-Token', csrfToken)
        .send({ salary: 'secret-payroll' })
        .expect(400);
      expect(logs).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'http_request',
          correlationId: response.headers['x-correlation-id'],
          status: 400,
        }),
      );
      expect(JSON.stringify(logs.mock.calls)).not.toMatch(
        /secret-|private-name/,
      );
    } finally {
      logs.mockRestore();
    }
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer()).get('/').expect(200).expect({
      name: 'coffer-api',
      status: 'ok',
      settlementMode: 'mock',
      liveTransfersEnabled: false,
    });
  });

  it('creates and settles a mock payment idempotently', async () => {
    const quote = await request(app.getHttpServer())
      .post('/v1/orgs/org_demo/payments/quotes')
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        sourceAssetId: 'mock:base:usdc',
        destinationAssetId: 'mock:near:usdc',
        amountAtomic: '12500000',
        recipient: 'merchant.near',
        refundTo: '0x1111111111111111111111111111111111111111',
        slippageBps: 50,
        confidentiality: 'none',
        scenario: 'success',
      })
      .expect(201);

    const first = await request(app.getHttpServer())
      .post('/v1/orgs/org_demo/payments')
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'checkout-1')
      .send({ quoteId: quote.body.id as string })
      .expect(201);
    const repeated = await request(app.getHttpServer())
      .post('/v1/orgs/org_demo/payments')
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'checkout-1')
      .send({ quoteId: quote.body.id as string })
      .expect(201);

    expect(repeated.body.id).toBe(first.body.id);

    const paymentId = first.body.id as string;
    await request(app.getHttpServer())
      .post(`/v1/orgs/org_demo/payments/${paymentId}/poll`)
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/orgs/org_demo/payments/${paymentId}/poll`)
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(201);
    const settled = await request(app.getHttpServer())
      .post(`/v1/orgs/org_demo/payments/${paymentId}/poll`)
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(201);

    expect(settled.body.status).toBe('SETTLED');
    expect(settled.body.settlementPostingCount).toBe(1);
  });

  it('T-ID-01/T-ID-08 creates one session and revokes it with CSRF proof', async () => {
    const challenge = await request(app.getHttpServer())
      .post('/v1/auth/near/challenge')
      .send({})
      .expect(201);
    const proof = {
      challengeId: challenge.body.challengeId as string,
      accountId: 'alice.testnet',
      publicKey: 'ed25519:11111111111111111111111111111111',
      signature: Buffer.alloc(64, 1).toString('base64'),
      nonce: challenge.body.nonce as string,
      state: challenge.body.state as string,
    };
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/near/verify')
      .send(proof)
      .expect(201);
    const setCookies = verified.headers['set-cookie'] as unknown as string[];
    const cookieHeader = setCookies
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');
    const csrfToken = /coffer_csrf=([^;]+)/.exec(cookieHeader)?.[1];
    expect(csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await request(app.getHttpServer())
      .post('/v1/auth/near/verify')
      .send(proof)
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', cookieHeader)
      .expect(200)
      .expect((response) => {
        expect(response.body.userId).toBe('user_1');
      });
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Cookie', cookieHeader)
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrfToken!)
      .expect(201)
      .expect({ status: 'revoked' });
    await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', cookieHeader)
      .expect(401);
  });

  it('returns a safe correlated error for invalid requests', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/orgs/org_demo/payments/quotes')
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .set('X-Correlation-ID', 'forged')
      .send({ secret: 'must-not-leak' })
      .expect(400);
    expect(response.body.error.code).toBe('HTTP_400');
    expect(response.body.error.correlationId).toBe(
      response.headers['x-correlation-id'],
    );
    expect(response.body.error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  });

  it('T-ID-05 denies unauthenticated, cross-tenant, and unauthorized writes', async () => {
    await request(app.getHttpServer())
      .post('/v1/orgs/org_demo/payments/quotes')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/orgs/org_other/payments/quotes')
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({})
      .expect(404);

    authStore.role = 'VIEWER';
    await request(app.getHttpServer())
      .post('/v1/orgs/org_demo/payments/quotes')
      .set('Cookie', authenticatedCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({})
      .expect(403);
  });

  afterEach(async () => {
    await app.close();
  });
});
