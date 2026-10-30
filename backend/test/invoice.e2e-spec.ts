import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
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
process.env.REDIS_URL ??= 'redis://localhost:6379';

class InvoiceE2eAuthStore implements AuthStore {
  role = 'FINANCE_ADMIN';

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
      sessionId: 'invoice-e2e-session',
      userId: this.userId,
      expiresAt: new Date(now.getTime() + 60_000),
      wallets: [{ network: 'testnet', accountId: 'finance.testnet' }],
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

describe('J-01 invoice API (e2e)', () => {
  const environment = parseEnvironment();
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const sessionToken = 's'.repeat(43);
  const csrfToken = 'x'.repeat(43);
  const cookie = `coffer_session=${sessionToken}; coffer_csrf=${csrfToken}`;
  let app: INestApplication<App>;
  let organizationId: string;
  let otherOrganizationId: string;
  let authStore: InvoiceE2eAuthStore;

  beforeAll(async () => {
    const [organization, other, user] = await Promise.all([
      prisma.organization.create({
        data: { slug: `invoice-e2e-${suffix}`, name: 'Invoice API Fixture' },
      }),
      prisma.organization.create({
        data: {
          slug: `invoice-e2e-other-${suffix}`,
          name: 'Other Invoice API Fixture',
        },
      }),
      prisma.user.create({
        data: {
          email: `invoice-e2e-${suffix}@example.test`,
          displayName: 'Invoice API Finance',
        },
      }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = other.id;
    authStore = new InvoiceE2eAuthStore(
      user.id,
      organization.id,
      createHash('sha256').update(sessionToken).digest('hex'),
      createHash('sha256').update(csrfToken).digest('hex'),
    );
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HealthDependencies)
      .useValue({ postgres: vi.fn(), redis: vi.fn() })
      .overrideProvider(AUTH_STORE)
      .useValue(authStore)
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

  it('creates, issues, publicly redacts, settles, and reads a paid invoice', async () => {
    const created = await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/invoices`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        invoiceNumber: `INV-E2E-${suffix}`,
        currency: 'mock:near:usdc',
        payeeDestination: 'merchant.near',
        customer: {
          displayName: 'Private Customer',
          email: 'not-public@example.test',
        },
        lineItems: [
          { description: 'Synthetic implementation', amountAtomic: '12500000' },
        ],
        metadata: { privateReference: 'never-public' },
        dueDate: '2026-11-30T12:00:00.000Z',
      })
      .expect(201);
    const invoiceId = created.body.invoice.id as string;
    const publicToken = created.body.publicToken as string;

    await request(app.getHttpServer())
      .get(`/v1/public/invoices/${publicToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/invoices/${invoiceId}/issue`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(201);
    const publicInvoice = await request(app.getHttpServer())
      .get(`/v1/public/invoices/${publicToken}`)
      .expect(200);
    expect(JSON.stringify(publicInvoice.body)).not.toMatch(
      /not-public|never-public|organizationId|createdByUserId/i,
    );

    const quote = await request(app.getHttpServer())
      .post(`/v1/public/invoices/${publicToken}/quotes`)
      .send({
        sourceAssetId: 'mock:base:usdc',
        refundTo: 'payer.near',
        slippageBps: 50,
        scenario: 'success',
      })
      .expect(201);
    expect(quote.body).toMatchObject({
      destinationAssetId: 'mock:near:usdc',
      amountAtomic: '12500000',
      recipient: 'merchant.near',
    });
    expect(quote.body).not.toHaveProperty('organizationId');
    expect(quote.body).not.toHaveProperty('invoiceId');
    expect(quote.body).not.toHaveProperty('requestDigest');
    const attempt = await request(app.getHttpServer())
      .post(`/v1/public/invoices/${publicToken}/payments`)
      .set('Idempotency-Key', `invoice-e2e-${suffix}`)
      .send({ quoteId: quote.body.id as string })
      .expect(201);
    expect(attempt.body).not.toHaveProperty('organizationId');
    expect(attempt.body).not.toHaveProperty('invoiceId');
    for (let poll = 0; poll < 3; poll += 1) {
      await request(app.getHttpServer())
        .post(
          `/v1/public/invoices/${publicToken}/payments/${attempt.body.id as string}/poll`,
        )
        .expect(201);
    }
    const paid = await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/invoices/${invoiceId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(paid.body).toMatchObject({
      status: 'PAID',
      paymentState: 'PAID',
      verifiedReceivedAtomic: '12500000',
      outstandingAmountAtomic: '0',
      paymentAttempts: [
        expect.objectContaining({ id: attempt.body.id, status: 'SETTLED' }),
      ],
    });
  });

  it('T-ID-05 hides cross-tenant invoices and denies viewer writes', async () => {
    await request(app.getHttpServer())
      .get(`/v1/orgs/${otherOrganizationId}/invoices/${randomUUID()}`)
      .set('Cookie', cookie)
      .expect(404);
    authStore.role = 'VIEWER';
    await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/invoices`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({})
      .expect(403);
  });
});
