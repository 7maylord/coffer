import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
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

process.env.DATABASE_URL ??=
  'postgresql://coffer:coffer_local@localhost:5433/coffer_dev';
process.env.REDIS_URL ??= 'redis://localhost:6379';

class PayrollE2eAuthStore implements AuthStore {
  constructor(
    private readonly sessions: Map<
      string,
      { userId: string; organizationId: string; role: string; csrfHash: string }
    >,
  ) {}
  async createChallenge() {}
  async findChallenge() {
    return null;
  }
  async consumeChallengeAndCreateSession() {
    return null;
  }
  async findActiveSession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    return {
      sessionId: `payroll-${session.userId}`,
      userId: session.userId,
      expiresAt: new Date(now.getTime() + 60_000),
      wallets: [],
      memberships: [
        { organizationId: session.organizationId, role: session.role },
      ],
    };
  }
  async hasActiveSessionWithCsrf(tokenHash: string, csrfTokenHash: string) {
    return this.sessions.get(tokenHash)?.csrfHash === csrfTokenHash;
  }
  async revokeSession() {
    return true;
  }
}

describe('J-05 private payroll API (e2e)', () => {
  const environment = parseEnvironment({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 13).toString('base64'),
    ENCRYPTION_KEY_VERSION: 'e2e-key-v1',
  });
  const prisma = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const ownerToken = 'o'.repeat(43);
  const ownerCsrf = 'p'.repeat(43);
  const employeeToken = 'e'.repeat(43);
  const employeeCsrf = 'f'.repeat(43);
  const ownerCookie = `coffer_session=${ownerToken}; coffer_csrf=${ownerCsrf}`;
  const employeeCookie = `coffer_session=${employeeToken}; coffer_csrf=${employeeCsrf}`;
  let app: INestApplication<App>;
  let organizationId: string;
  let otherOrganizationId: string;
  let ownerUserId: string;
  let employeeUserId: string;
  let batchId: string;
  let lineId: string;
  let manifestDigest: string;

  beforeAll(async () => {
    const [organization, other, owner, employee] = await Promise.all([
      prisma.organization.create({
        data: { slug: `payroll-e2e-${suffix}`, name: 'Payroll API' },
      }),
      prisma.organization.create({
        data: {
          slug: `payroll-e2e-other-${suffix}`,
          name: 'Other Payroll API',
        },
      }),
      prisma.user.create({ data: { displayName: 'Payroll Owner' } }),
      prisma.user.create({ data: { displayName: 'Payroll Employee' } }),
    ]);
    organizationId = organization.id;
    otherOrganizationId = other.id;
    ownerUserId = owner.id;
    employeeUserId = employee.id;
    await prisma.membership.createMany({
      data: [
        { organizationId, userId: ownerUserId, role: 'OWNER' },
        { organizationId, userId: employeeUserId, role: 'EMPLOYEE' },
      ],
    });
    const sessions = new Map([
      [
        createHash('sha256').update(ownerToken).digest('hex'),
        {
          userId: ownerUserId,
          organizationId,
          role: 'OWNER',
          csrfHash: createHash('sha256').update(ownerCsrf).digest('hex'),
        },
      ],
      [
        createHash('sha256').update(employeeToken).digest('hex'),
        {
          userId: employeeUserId,
          organizationId,
          role: 'EMPLOYEE',
          csrfHash: createHash('sha256').update(employeeCsrf).digest('hex'),
        },
      ],
    ]);
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_ENVIRONMENT)
      .useValue(environment)
      .overrideProvider(HealthDependencies)
      .useValue({ postgres: vi.fn(), redis: vi.fn() })
      .overrideProvider(AUTH_STORE)
      .useValue(new PayrollE2eAuthStore(sessions))
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

  it('imports, audits, approves, and exposes only the employee own payslip', async () => {
    const imported = await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/payroll/imports`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({
        reference: `SYNTHETIC-${suffix}`,
        assetId: 'mock:base:usdc',
        synthetic: true,
        perEmployeeCapAtomic: '5000000',
        batchCapAtomic: '5000000',
        csv: [
          'employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic',
          `EMP-${suffix},${employeeUserId},Synthetic Person,Synthetic Address,employee.testnet,1000000`,
        ].join('\n'),
      })
      .expect(201);
    batchId = imported.body.id as string;
    manifestDigest = imported.body.manifestDigest as string;
    const line = await prisma.payrollLine.findFirstOrThrow({
      where: { batchId },
    });
    lineId = line.id;

    await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/payroll/batches`)
      .set('Cookie', ownerCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject([{ id: batchId, lineCount: 1 }]);
        expect(JSON.stringify(body)).not.toContain('Synthetic Person');
      });

    await request(app.getHttpServer())
      .get(`/v1/orgs/${otherOrganizationId}/payroll/batches`)
      .set('Cookie', ownerCookie)
      .expect(404);

    const financeView = await request(app.getHttpServer())
      .get(`/v1/orgs/${organizationId}/payroll/batches/${batchId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(financeView.body.lines[0]).toMatchObject({
      grossAmountAtomic: '1000000',
      profile: { legalName: 'Synthetic Person' },
    });

    await request(app.getHttpServer())
      .get(`/v1/orgs/${otherOrganizationId}/payroll/batches/${batchId}`)
      .set('Cookie', ownerCookie)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/v1/me/payslips/${lineId}`)
      .set('Cookie', employeeCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          legalName: 'Synthetic Person',
          netAmountAtomic: '1000000',
        });
      });

    await request(app.getHttpServer())
      .get('/v1/me/payslips')
      .set('Cookie', employeeCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject([
          {
            id: lineId,
            legalName: 'Synthetic Person',
            netAmountAtomic: '1000000',
          },
        ]);
      });

    await request(app.getHttpServer())
      .get('/v1/me/payslips')
      .set('Cookie', ownerCookie)
      .expect(200)
      .expect([]);

    await request(app.getHttpServer())
      .get(`/v1/me/payslips/${lineId}`)
      .set('Cookie', ownerCookie)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/payroll/batches/${batchId}/analysis`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ mode: 'private-ai' })
      .expect(503);

    await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/payroll/batches/${batchId}/analysis`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ mode: 'deterministic' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.attestationStatus).toBe('NOT_REQUESTED');
      });

    await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/payroll/batches/${batchId}/approve`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ expectedManifestDigest: manifestDigest, expectedVersion: 1 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('APPROVED');
      });
  });
});
