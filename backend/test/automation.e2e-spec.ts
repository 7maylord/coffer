import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import {
  LedgerAccountType,
  LedgerNormalSide,
  PrismaClient,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { APP_ENVIRONMENT, parseEnvironment } from '../src/config/env.js';
import {
  AUTH_STORE,
  NEP413_VERIFIER,
  type AuthStore,
} from '../src/auth/auth.types.js';
import { HealthDependencies } from '../src/health/health.service.js';
import {
  MOCK_VENDOR_ID,
  MOCK_VENDOR_RECIPIENT_COMMITMENT,
} from '../src/automation/mock-vendor.adapter.js';

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';
process.env.REDIS_URL ??= 'redis://localhost:6379';

class AutomationE2eAuthStore implements AuthStore {
  constructor(
    private readonly userId: string,
    private readonly organizationId: string,
    private readonly sessionHash: string,
    private readonly csrfHash: string,
    private readonly walletAccountId: string,
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
      sessionId: 'automation-e2e-session',
      userId: this.userId,
      expiresAt: new Date(now.getTime() + 60_000),
      wallets: [{ network: 'testnet', accountId: this.walletAccountId }],
      memberships: [
        { organizationId: this.organizationId, role: 'OWNER' as const },
      ],
    };
  }
  async hasActiveSessionWithCsrf(tokenHash: string, csrfTokenHash: string) {
    return tokenHash === this.sessionHash && csrfTokenHash === this.csrfHash;
  }
  async revokeSession() {
    return true;
  }
}

describe('J-02/J-03 automation API (e2e)', () => {
  const environment = parseEnvironment({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    FEATURE_AGENT_EXECUTION: 'true',
  });
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const walletAccountId = `owner-${suffix}.testnet`;
  const sessionToken = 'a'.repeat(43);
  const csrfToken = 'z'.repeat(43);
  const cookie = `coffer_session=${sessionToken}; coffer_csrf=${csrfToken}`;
  let app: INestApplication<App>;
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;
  let accountId: string;
  let invoiceId: string;

  beforeAll(async () => {
    const [organization, other, user] = await Promise.all([
      prisma.organization.create({
        data: { slug: `automation-e2e-${suffix}`, name: 'Automation API' },
      }),
      prisma.organization.create({
        data: {
          slug: `automation-e2e-other-${suffix}`,
          name: 'Automation API Other',
        },
      }),
      prisma.user.create({
        data: { displayName: 'Automation API Owner' },
      }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = other.id;
    userId = user.id;
    await prisma.membership.create({
      data: {
        organizationId,
        userId,
        role: 'OWNER',
      },
    });
    await prisma.walletAccount.create({
      data: {
        userId,
        network: 'testnet',
        accountId: walletAccountId,
        lastPublicKey: 'ed25519:11111111111111111111111111111111',
        verifiedAt: new Date(),
      },
    });
    const account = await prisma.ledgerAccount.create({
      data: {
        organizationId,
        assetId: 'mock:base:usdc',
        code: 'AUTOMATION_E2E',
        name: 'Automation E2E Cash',
        accountType: LedgerAccountType.ASSET,
        normalSide: LedgerNormalSide.DEBIT,
        postedBalanceAtomic: 10_000_000,
      },
    });
    accountId = account.id;
    const invoice = await prisma.invoice.create({
      data: {
        organizationId,
        invoiceNumber: `AI-${suffix}`,
        currency: 'mock:base:usdc',
        totalAmountAtomic: 1_000_000,
        publicTokenHash: randomUUID().replaceAll('-', ''),
        payeeDestination: 'merchant.test',
        customer: { displayName: 'Synthetic Customer' },
        lineItems: [{ description: 'Synthetic', amountAtomic: '1000000' }],
        metadata: {},
        dueDate: new Date(Date.now() + 86_400_000),
        createdByUserId: userId,
      },
    });
    invoiceId = invoice.id;
    const auth = new AutomationE2eAuthStore(
      userId,
      organizationId,
      createHash('sha256').update(sessionToken).digest('hex'),
      createHash('sha256').update(csrfToken).digest('hex'),
      walletAccountId,
    );
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_ENVIRONMENT)
      .useValue(environment)
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

  it('creates a typed CFO suggestion and reserves only after human approval', async () => {
    const created = await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/ai/cfo/proposals`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        sourceAccountId: accountId,
        assetId: 'mock:base:usdc',
        maximumAmountAtomic: '1000000',
        allowedCategories: ['Operations'],
        supportingRecordIds: [invoiceId],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      provider: 'mock-cfo',
      attestationStatus: 'NOT_REQUESTED',
      reservationId: null,
    });
    const workspace = await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/ai/cfo/workspace`)
      .set('Cookie', cookie)
      .expect(200);
    expect(workspace.body).toMatchObject({
      providerMode: 'mock',
      nearAiEnabled: false,
      attestationVerification: 'not-implemented',
      proposals: [expect.objectContaining({ id: created.body.id })],
    });
    const before = await prisma.balanceReservation.count({
      where: { organizationId },
    });
    expect(before).toBe(0);

    const approved = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/ai/cfo/proposals/${created.body.id as string}/decision`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ decision: 'APPROVED', note: 'Human reviewed fixture' })
      .expect(201);
    expect(approved.body).toMatchObject({ status: 'APPROVED' });
    expect(approved.body.reservationId).toMatch(/^[0-9a-f-]{36}$/);

    await request(app.getHttpServer())
      .get(
        `/v1/orgs/${otherOrganizationId}/ai/cfo/proposals/${created.body.id as string}`,
      )
      .set('Cookie', cookie)
      .expect(404);
  });

  it('binds a seeded offer to policy approval before mock fulfillment', async () => {
    const agent = await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/agents`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        purpose: 'Classify synthetic documents',
        allowedActions: ['purchase:document-classification'],
        assetId: 'mock:base:usdc',
        chainId: 'mock:base',
        maxAmountAtomic: '2000000',
        rollingBudgetAtomic: '5000000',
        vendorAllowlist: [MOCK_VENDOR_ID],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/policies`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        rules: {
          assetLimits: {
            'mock:base:usdc': {
              perTransactionCapAtomic: '2000000',
              rollingWindowCapAtomic: '5000000',
              approvalRequiredAboveAtomic: '0',
            },
          },
          allowedChainIds: ['mock:base'],
          allowedRecipientCommitments: [MOCK_VENDOR_RECIPIENT_COMMITMENT],
          rollingWindowSeconds: 86400,
          approvalThreshold: 1,
          agentCapsAtomic: { [agent.body.id as string]: '2000000' },
          vendorCapsAtomic: { [MOCK_VENDOR_ID]: '2000000' },
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          frozen: false,
        },
      })
      .expect(201);

    const offer = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/agents/${agent.body.id as string}/offers`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        serviceCode: 'document-classification',
        documentCount: 10,
        classificationProfile: 'financial',
      })
      .expect(201);
    const purchase = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/agents/${agent.body.id as string}/purchase-proposals`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ offerId: offer.body.id })
      .expect(201);
    expect(purchase.body.status).toBe('AWAITING_APPROVAL');

    const workspace = await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/agent-workspace`)
      .set('Cookie', cookie)
      .expect(200);
    expect(workspace.body).toMatchObject({
      executionEnabled: true,
      settlementMode: 'mock',
      vendor: { untrustedTextUsedForAuthorization: false },
      purchases: [
        expect.objectContaining({
          id: purchase.body.id,
          financialProposal: expect.objectContaining({
            id: purchase.body.financialProposalId,
          }),
        }),
      ],
    });

    await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/agent-purchases/${purchase.body.id as string}/approvals`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ nearAccountId: walletAccountId })
      .expect(201);

    const completed = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/agent-purchases/${purchase.body.id as string}/execute`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(201);
    expect(completed.body).toMatchObject({
      status: 'COMPLETED',
      deliverable: {
        serviceCode: 'document-classification',
        processedDocuments: 10,
      },
    });
    expect(completed.body.mockPaymentReference).toMatch(/^mock-service:/);

    const policy = await request(app.getHttpServer())
      .post(
        `/v1/orgs/${organizationId}/agents/${agent.body.id as string}/policy`,
      )
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(201);
    expect(policy.body.rules).toMatchObject({
      approvalThreshold: 2,
      agentCapsAtomic: { [agent.body.id as string]: '2000000' },
      vendorCapsAtomic: { [MOCK_VENDOR_ID]: '2000000' },
    });
  });
});
