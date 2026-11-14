import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseEnvironment } from '../src/config/env.js';
import { PayrollEnvelopeEncryption } from '../src/payroll/payroll-crypto.js';
import { PayrollService } from '../src/payroll/payroll.service.js';
import { PrismaPayrollStore } from '../src/payroll/prisma-payroll.store.js';
import type {
  PayrollAttestationVerifier,
  PrivatePayrollAnalyzer,
} from '../src/payroll/payroll.types.js';
import { AssetRegistry } from '../src/treasury/asset-registry.js';
import { NearTestnetTransferAdapter } from '../src/settlement/near-testnet-transfer.adapter.js';
import { ProviderAdapterError } from '../src/settlement/provider-adapter.types.js';

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('private payroll persistence invariants', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const environment = parseEnvironment({
    DATABASE_URL: databaseUrl,
    ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 11).toString('base64'),
    ENCRYPTION_KEY_VERSION: 'integration-key-v1',
  });
  const store = new PrismaPayrollStore(environment);
  const unavailable: PrivatePayrollAnalyzer = {
    provider: 'fixture',
    model: 'fixture',
    analyze: vi.fn().mockRejectedValue(new Error('unavailable')),
  };
  const verifier: PayrollAttestationVerifier = {
    verify: vi.fn().mockReturnValue(false),
  };
  const service = new PayrollService(
    store,
    unavailable,
    verifier,
    new PayrollEnvelopeEncryption(environment),
    new AssetRegistry(),
    environment,
    {} as NearTestnetTransferAdapter,
  );
  let organizationId: string;
  let otherOrganizationId: string;
  let financeUserId: string;
  let employeeUserId: string;
  let otherEmployeeUserId: string;
  let batchId: string;
  let lineId: string;

  beforeAll(async () => {
    const suffix = randomUUID();
    const [organization, otherOrganization, finance, employee, otherEmployee] =
      await Promise.all([
        prisma.organization.create({
          data: { slug: `payroll-${suffix}`, name: 'Payroll Fixture' },
        }),
        prisma.organization.create({
          data: { slug: `payroll-other-${suffix}`, name: 'Other Fixture' },
        }),
        prisma.user.create({ data: { displayName: 'Finance Fixture' } }),
        prisma.user.create({ data: { displayName: 'Employee Fixture' } }),
        prisma.user.create({ data: { displayName: 'Other Employee' } }),
      ]);
    organizationId = organization.id;
    otherOrganizationId = otherOrganization.id;
    financeUserId = finance.id;
    employeeUserId = employee.id;
    otherEmployeeUserId = otherEmployee.id;
    await prisma.membership.createMany({
      data: [
        { organizationId, userId: financeUserId, role: 'FINANCE_ADMIN' },
        { organizationId, userId: employeeUserId, role: 'EMPLOYEE' },
        { organizationId, userId: otherEmployeeUserId, role: 'EMPLOYEE' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.payrollAnalysisRun.deleteMany({ where: { organizationId } });
    await prisma.payrollPayoutItem.deleteMany({ where: { organizationId } });
    await prisma.payrollPayoutRun.deleteMany({ where: { organizationId } });
    await prisma.payrollBatch.deleteMany({ where: { organizationId } });
    await prisma.employeeProfile.deleteMany({ where: { organizationId } });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT set_config('coffer.audit_reset', 'on', true)",
      );
      await tx.auditEvent.deleteMany({ where: { organizationId } });
    });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [financeUserId, employeeUserId, otherEmployeeUserId] },
      },
    });
    await Promise.all([store.onModuleDestroy(), prisma.$disconnect()]);
  });

  it('imports encrypted rows and never stores payroll plaintext', async () => {
    const imported = await service.importSynthetic(
      organizationId,
      financeUserId,
      {
        reference: `SYNTHETIC-${randomUUID()}`,
        assetId: 'mock:base:usdc',
        synthetic: true,
        perEmployeeCapAtomic: '5000000',
        batchCapAtomic: '5000000',
        csv: [
          'employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic',
          `EMP-001,${employeeUserId},Secret Legal Name,Secret Address,secret.testnet,1000000`,
        ].join('\n'),
      },
    );
    batchId = imported.id;
    const stored = await prisma.payrollBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { lines: true },
    });
    lineId = stored.lines[0]!.id;
    expect(stored.wrappedDataKey).toHaveLength(48);
    expect(stored.lines[0]!.profileCiphertext.toString()).not.toContain(
      'Secret Legal Name',
    );
    const profile = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId, employeeCode: 'EMP-001' },
    });
    expect(profile.displayName).toBe('EMP-001');
  });

  it('T-ID-05/T-ID-06 enforces tenant and self-only reads and audits denied disclosure', async () => {
    await expect(
      service.batch(otherOrganizationId, batchId, financeUserId),
    ).rejects.toMatchObject({ code: 'PAYROLL_NOT_FOUND' });
    await expect(
      service.payslip(employeeUserId, lineId),
    ).resolves.toMatchObject({
      legalName: 'Secret Legal Name',
      grossAmountAtomic: '1000000',
    });
    await expect(
      service.payslip(otherEmployeeUserId, lineId),
    ).rejects.toMatchObject({ code: 'PAYROLL_NOT_FOUND' });
    await expect(
      prisma.auditEvent.count({
        where: {
          organizationId,
          eventType: { in: ['PAYSLIP_SELF_READ', 'PAYSLIP_ACCESS_DENIED'] },
        },
      }),
    ).resolves.toBe(2);
  });

  it('binds approval to the immutable manifest and rejects row mutation', async () => {
    const batch = await store.batch(organizationId, batchId);
    expect(batch).not.toBeNull();
    await expect(
      service.approve(
        organizationId,
        batchId,
        financeUserId,
        batch!.manifestDigest,
        batch!.version,
      ),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    await expect(
      prisma.payrollLine.update({
        where: { id: lineId },
        data: { amountCommitment: 'f'.repeat(64) },
      }),
    ).rejects.toThrow('append-only');
    await expect(
      prisma.payrollBatch.update({
        where: { id: batchId },
        data: { manifestDigest: 'f'.repeat(64) },
      }),
    ).rejects.toThrow('manifest fields cannot change');
  });

  it('T-PAY-07/T-PAY-10 durably rechecks only the originally submitted payout hash', async () => {
    const payoutEnvironment = parseEnvironment({
      DATABASE_URL: databaseUrl,
      ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 11).toString('base64'),
      ENCRYPTION_KEY_VERSION: 'integration-key-v1',
      LIVE_TRANSFERS_ENABLED: 'true',
      NEAR_TESTNET_TRANSFERS_ENABLED: 'true',
      FEATURE_PAYROLL_BATCH_PAYOUT: 'true',
    });
    const transactionHash = randomUUID()
      .replaceAll('-', '')
      .replaceAll('0', '1')
      .padEnd(43, '1');
    const verifyAndClaim = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderAdapterError('PROVIDER_UNAVAILABLE', 'RPC timeout'),
      )
      .mockImplementation(async (instruction) => ({
        ...instruction,
        provider: 'near-testnet',
        evidenceDigest: 'e'.repeat(64),
        verifiedAt: '2026-11-14T00:00:00.000Z',
      }));
    const payoutService = new PayrollService(
      store,
      unavailable,
      verifier,
      new PayrollEnvelopeEncryption(payoutEnvironment),
      new AssetRegistry(),
      payoutEnvironment,
      {
        walletTransaction: vi.fn(async (instruction) => ({
          network: 'testnet',
          signerAccountId: instruction.signerAccountId,
          receiverId: instruction.receiverAccountId,
          actions: [
            { type: 'Transfer', amountAtomic: instruction.amountAtomic },
          ],
        })),
        verifyAndClaim,
      } as unknown as NearTestnetTransferAdapter,
    );
    const payoutBatch = await payoutService.importSynthetic(
      organizationId,
      financeUserId,
      {
        reference: `SYNTHETIC-PAYOUT-${randomUUID()}`,
        assetId: 'near:testnet:native',
        synthetic: true,
        perEmployeeCapAtomic: '5000000',
        batchCapAtomic: '5000000',
        csv: [
          'employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic',
          `EMP-001,${employeeUserId},Synthetic Person,Synthetic Address,employee.testnet,1000000`,
        ].join('\n'),
      },
    );
    await payoutService.approve(
      organizationId,
      payoutBatch.id,
      financeUserId,
      payoutBatch.manifestDigest,
      payoutBatch.version,
    );
    const prepared = await payoutService.preparePayout(
      organizationId,
      payoutBatch.id,
      financeUserId,
      'payer.testnet',
      `payroll:${payoutBatch.id}:v2`,
    );
    const itemId = prepared.items[0]!.id;

    await expect(
      payoutService.reconcilePayoutItem(
        organizationId,
        payoutBatch.id,
        itemId,
        financeUserId,
        transactionHash,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(
      prisma.payrollPayoutItem.findUniqueOrThrow({ where: { id: itemId } }),
    ).resolves.toMatchObject({
      status: 'RECONCILING',
      transactionHash,
    });
    await expect(
      payoutService.reconcilePayoutItem(
        organizationId,
        payoutBatch.id,
        itemId,
        financeUserId,
        '2'.repeat(43),
      ),
    ).rejects.toMatchObject({ code: 'PAYROLL_PAYOUT_CONFLICT' });
    expect(verifyAndClaim).toHaveBeenCalledTimes(1);
    await expect(
      payoutService.reconcilePayoutItem(
        organizationId,
        payoutBatch.id,
        itemId,
        financeUserId,
        transactionHash,
      ),
    ).resolves.toMatchObject({ status: 'SETTLED' });
  });
});
