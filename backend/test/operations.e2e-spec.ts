import { createHash, randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  AUTH_STORE,
  NEP413_VERIFIER,
  type AuthStore,
} from '../src/auth/auth.types.js';
import { parseEnvironment } from '../src/config/env.js';
import { HealthDependencies } from '../src/health/health.service.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';

class OperationsAuthStore implements AuthStore {
  role = 'AUDITOR';

  constructor(
    private readonly userId: string,
    private readonly organizationId: string,
    private readonly sessionHash: string,
    private readonly csrfHash: string,
  ) {}

  async createChallenge() {}
  async findChallenge() {
    return null;
  }
  async consumeChallengeAndCreateSession() {
    return null;
  }
  async findActiveSession(tokenHash: string, now: Date) {
    if (tokenHash !== this.sessionHash) return null;
    return {
      sessionId: 'operations-e2e-session',
      userId: this.userId,
      expiresAt: new Date(now.getTime() + 60_000),
      wallets: [],
      memberships: [{ organizationId: this.organizationId, role: this.role }],
    };
  }
  async hasActiveSessionWithCsrf(tokenHash: string, csrfTokenHash: string) {
    return tokenHash === this.sessionHash && csrfTokenHash === this.csrfHash;
  }
  async revokeSession() {
    return true;
  }
}

describe('B-10 audit and operator API (e2e)', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const sessionToken = 'o'.repeat(43);
  const csrfToken = 'r'.repeat(43);
  const cookie = `coffer_session=${sessionToken}; coffer_csrf=${csrfToken}`;
  let app: INestApplication<App>;
  let auth: OperationsAuthStore;
  let organizationId: string;
  let otherOrganizationId: string;
  let caseId: string;

  beforeAll(async () => {
    const [organization, other, user] = await Promise.all([
      prisma.organization.create({
        data: { slug: `operations-e2e-${suffix}`, name: 'Operations E2E' },
      }),
      prisma.organization.create({
        data: {
          slug: `operations-e2e-other-${suffix}`,
          name: 'Other Operations E2E',
        },
      }),
      prisma.user.create({ data: { displayName: 'Operations E2E User' } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = other.id;
    await prisma.membership.create({
      data: { organizationId, userId: user.id, role: 'AUDITOR' },
    });
    const quote = await prisma.quoteSnapshot.create({
      data: {
        organizationId,
        provider: 'mock',
        sourceAssetId: 'mock:base:usdc',
        destinationAssetId: 'mock:near:usdc',
        amountAtomic: '100',
        expectedAmountAtomic: '100',
        recipient: 'synthetic.near',
        refundTo: 'refund.near',
        slippageBps: 50,
        confidentiality: 'none',
        scenario: 'unknown',
        requestDigest: createHash('sha256').update(suffix).digest('hex'),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const payment = await prisma.paymentAttempt.create({
      data: {
        organizationId,
        quoteId: quote.id,
        idempotencyKey: `operations-e2e-${suffix}`,
        requestDigest: createHash('sha256')
          .update(`${suffix}:payment`)
          .digest('hex'),
        provider: 'mock',
        status: 'UNKNOWN_REQUIRES_RECONCILIATION',
      },
    });
    const reconciliation = await prisma.reconciliationCase.create({
      data: {
        organizationId,
        paymentAttemptId: payment.id,
        reasonCode: 'E2E_UNKNOWN',
      },
    });
    caseId = reconciliation.id;
    auth = new OperationsAuthStore(
      user.id,
      organizationId,
      createHash('sha256').update(sessionToken).digest('hex'),
      createHash('sha256').update(csrfToken).digest('hex'),
    );
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HealthDependencies)
      .useValue({ postgres: vi.fn(), redis: vi.fn() })
      .overrideProvider(AUTH_STORE)
      .useValue(auth)
      .overrideProvider(NEP413_VERIFIER)
      .useValue({ verify: vi.fn() })
      .compile();
    app = fixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('gives auditors redacted reads and finance an idempotent safe recheck', async () => {
    const audit = await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/audit?limit=25`)
      .set('Cookie', cookie)
      .expect(200);
    expect(audit.body.integrity).toMatchObject({ verified: true });
    expect(audit.body.events.length).toBeGreaterThan(0);
    expect(
      audit.body.events.every(
        (event: Record<string, unknown>) => !('organizationId' in event),
      ),
    ).toBe(true);

    const dashboard = await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/operations/settlements`)
      .set('Cookie', cookie)
      .expect(200);
    expect(dashboard.body.stuck[0]).toMatchObject({
      status: 'UNKNOWN_REQUIRES_RECONCILIATION',
    });
    await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/operations/metrics`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/operations/finance-agent-runs`)
      .set('Cookie', cookie)
      .expect(200, []);
    await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/operations/reconciliation/${caseId}/recheck`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `e2e-${suffix}`)
      .expect(403);

    auth.role = 'FINANCE_ADMIN';
    const first = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/operations/reconciliation/${caseId}/recheck`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `e2e-${suffix}`)
      .expect(201);
    const replayed = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/operations/reconciliation/${caseId}/recheck`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', `e2e-${suffix}`)
      .expect(201);
    expect(replayed.body).toEqual(first.body);
    expect(first.body.action).toBe('RECHECK_EXISTING_PAYMENT');

    await request(app.getHttpServer())
      .get(`/v1/orgs/${otherOrganizationId}/operations/settlements`)
      .set('Cookie', cookie)
      .expect(404);
  });
});
