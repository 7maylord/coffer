import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { HealthDependencies } from './health/health.service.js';
import { createOpenApiDocument } from './openapi.js';

describe('generated OpenAPI', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HealthDependencies)
      .useValue({ postgres: vi.fn(), redis: vi.fn() })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());

  it('documents every current HTTP route with stable operation IDs', () => {
    const document = createOpenApiDocument(app);
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths).sort()).toEqual([
      '/',
      '/health/live',
      '/health/ready',
      '/v1/auth/logout',
      '/v1/auth/near/challenge',
      '/v1/auth/near/verify',
      '/v1/auth/session',
      '/v1/invites/accept',
      '/v1/me/payslips',
      '/v1/me/payslips/{lineId}',
      '/v1/organizations',
      '/v1/orgs/{orgId}/agent-purchases/{purchaseId}',
      '/v1/orgs/{orgId}/agent-purchases/{purchaseId}/approvals',
      '/v1/orgs/{orgId}/agent-purchases/{purchaseId}/execute',
      '/v1/orgs/{orgId}/agent-workspace',
      '/v1/orgs/{orgId}/agents',
      '/v1/orgs/{orgId}/agents/{agentId}/offers',
      '/v1/orgs/{orgId}/agents/{agentId}/policy',
      '/v1/orgs/{orgId}/agents/{agentId}/purchase-proposals',
      '/v1/orgs/{orgId}/agents/{agentId}/revoke',
      '/v1/orgs/{orgId}/ai/cfo/proposals',
      '/v1/orgs/{orgId}/ai/cfo/proposals/{proposalId}',
      '/v1/orgs/{orgId}/ai/cfo/proposals/{proposalId}/decision',
      '/v1/orgs/{orgId}/ai/cfo/workspace',
      '/v1/orgs/{orgId}/audit',
      '/v1/orgs/{orgId}/invites',
      '/v1/orgs/{orgId}/invoices',
      '/v1/orgs/{orgId}/invoices/{invoiceId}',
      '/v1/orgs/{orgId}/invoices/{invoiceId}/expire',
      '/v1/orgs/{orgId}/invoices/{invoiceId}/issue',
      '/v1/orgs/{orgId}/invoices/{invoiceId}/void',
      '/v1/orgs/{orgId}/members',
      '/v1/orgs/{orgId}/members/{userId}',
      '/v1/orgs/{orgId}/operations/metrics',
      '/v1/orgs/{orgId}/operations/reconciliation/{caseId}/recheck',
      '/v1/orgs/{orgId}/operations/settlements',
      '/v1/orgs/{orgId}/payments',
      '/v1/orgs/{orgId}/payments/quotes',
      '/v1/orgs/{orgId}/payments/{paymentId}',
      '/v1/orgs/{orgId}/payments/{paymentId}/poll',
      '/v1/orgs/{orgId}/payroll/batches',
      '/v1/orgs/{orgId}/payroll/batches/{batchId}',
      '/v1/orgs/{orgId}/payroll/batches/{batchId}/analysis',
      '/v1/orgs/{orgId}/payroll/batches/{batchId}/approve',
      '/v1/orgs/{orgId}/payroll/batches/{batchId}/audit',
      '/v1/orgs/{orgId}/payroll/batches/{batchId}/payouts',
      '/v1/orgs/{orgId}/payroll/batches/{batchId}/payouts/items/{itemId}/reconcile',
      '/v1/orgs/{orgId}/payroll/imports',
      '/v1/orgs/{orgId}/policies',
      '/v1/orgs/{orgId}/policies/active',
      '/v1/orgs/{orgId}/policy-contract/binding',
      '/v1/orgs/{orgId}/policy-contract/deployment',
      '/v1/orgs/{orgId}/policy-contract/deployment-preview',
      '/v1/orgs/{orgId}/proposals',
      '/v1/orgs/{orgId}/proposals/{proposalId}',
      '/v1/orgs/{orgId}/proposals/{proposalId}/approvals',
      '/v1/orgs/{orgId}/proposals/{proposalId}/revisions',
      '/v1/orgs/{orgId}/proposals/{proposalId}/verify',
      '/v1/orgs/{orgId}/settlement/intents/dry-quote',
      '/v1/orgs/{orgId}/settlement/intents/swaps',
      '/v1/orgs/{orgId}/settlement/intents/swaps/{swapId}',
      '/v1/orgs/{orgId}/settlement/intents/swaps/{swapId}/deposit-evidence',
      '/v1/orgs/{orgId}/settlement/intents/swaps/{swapId}/poll',
      '/v1/orgs/{orgId}/treasury',
      '/v1/orgs/{orgId}/treasury/policy',
      '/v1/orgs/{orgId}/treasury/split-proposals',
      '/v1/orgs/{orgId}/treasury/split-proposals/preview',
      '/v1/orgs/{orgId}/treasury/split-proposals/{proposalId}/approvals',
      '/v1/orgs/{orgId}/treasury/split-proposals/{proposalId}/cancel',
      '/v1/orgs/{orgId}/treasury/split-proposals/{proposalId}/reserve',
      '/v1/orgs/{orgId}/treasury/split-proposals/{proposalId}/revisions',
      '/v1/public/invoices/{publicToken}',
      '/v1/public/invoices/{publicToken}/near-testnet/payments',
      '/v1/public/invoices/{publicToken}/near-testnet/payments/{paymentId}/evidence',
      '/v1/public/invoices/{publicToken}/payments',
      '/v1/public/invoices/{publicToken}/payments/{paymentId}',
      '/v1/public/invoices/{publicToken}/payments/{paymentId}/poll',
      '/v1/public/invoices/{publicToken}/quotes',
      '/v1/public/invoices/{publicToken}/settlement/assets',
      '/v1/settlement/assets',
      '/v1/settlement/intents/assets',
    ]);
    expect(document.paths['/v1/orgs/{orgId}/payments']?.post?.operationId).toBe(
      'Settlement.initiate',
    );
    expect(
      document.paths['/v1/orgs/{orgId}/proposals/{proposalId}/verify']?.post
        ?.operationId,
    ).toBe('Policy.verify');
    expect(
      JSON.stringify(
        document.paths['/v1/orgs/{orgId}/policy-contract/deployment']?.get
          ?.responses,
      ),
    ).toContain('deploymentStatus');
  });

  it('models exact atomic amounts as decimal strings and safe defaults', () => {
    const document = createOpenApiDocument(app);
    const schema =
      document.paths['/v1/orgs/{orgId}/payments/quotes']?.post?.requestBody;
    expect(JSON.stringify(schema)).toContain('^[1-9][0-9]*$');
    expect(JSON.stringify(schema)).toContain('partial_deposit');
    expect(document.info.description).not.toMatch(/mainnet|live transfer/i);
    const proposal = document.paths['/v1/orgs/{orgId}/proposals']?.post;
    expect(JSON.stringify(proposal?.requestBody)).toContain(
      'authorizedMaxAtomic',
    );
    expect(proposal?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-CSRF-Token' }),
      ]),
    );
    const invoice = document.paths['/v1/orgs/{orgId}/invoices']?.post;
    expect(JSON.stringify(invoice?.requestBody)).toContain('amountAtomic');
    expect(JSON.stringify(invoice?.requestBody)).toContain('^[1-9][0-9]*$');
    expect(
      document.paths['/v1/public/invoices/{publicToken}']?.get?.security,
    ).toBeUndefined();
    const publicQuote =
      document.paths['/v1/public/invoices/{publicToken}/quotes']?.post;
    expect(publicQuote?.security).toBeUndefined();
    expect(JSON.stringify(publicQuote?.requestBody)).not.toContain(
      'amountAtomic',
    );
    expect(JSON.stringify(publicQuote?.requestBody)).not.toContain('recipient');
    const payrollImport =
      document.paths['/v1/orgs/{orgId}/payroll/imports']?.post;
    expect(JSON.stringify(payrollImport?.requestBody)).toContain('synthetic');
    expect(JSON.stringify(payrollImport?.requestBody)).toContain(
      'perEmployeeCapAtomic',
    );
    const treasurySplit =
      document.paths['/v1/orgs/{orgId}/treasury/split-proposals']?.post;
    expect(JSON.stringify(treasurySplit?.requestBody)).toContain(
      'sourceAccountId',
    );
    expect(JSON.stringify(treasurySplit?.requestBody)).not.toContain(
      'recipientCommitment',
    );
    expect(JSON.stringify(treasurySplit?.responses)).toContain(
      'instructionDigest',
    );
    const intentsSwap =
      document.paths['/v1/orgs/{orgId}/settlement/intents/swaps']?.post;
    expect(JSON.stringify(intentsSwap?.requestBody)).toContain('amountAtomic');
    expect(JSON.stringify(intentsSwap?.responses)).toContain(
      'settlementCredited',
    );
  });
});
