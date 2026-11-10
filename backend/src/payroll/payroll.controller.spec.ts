import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import { PayrollController, PayslipController } from './payroll.controller.js';
import { PayrollService } from './payroll.service.js';
import { PayrollError, type PayrollErrorCode } from './payroll.types.js';
import { ProviderAdapterError } from '../settlement/provider-adapter.types.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';

function principal(): AuthenticatedRequest {
  return {
    [AUTH_PRINCIPAL]: {
      sessionId: 'session-1',
      userId,
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      wallets: [],
      memberships: [{ organizationId, role: 'OWNER' }],
    },
  } as unknown as AuthenticatedRequest;
}

function service() {
  return {
    importSynthetic: vi.fn().mockResolvedValue({ id: entityId }),
    batches: vi.fn().mockResolvedValue([{ id: entityId }]),
    batch: vi.fn().mockResolvedValue({ id: entityId }),
    auditView: vi.fn().mockResolvedValue({ id: entityId }),
    approve: vi.fn().mockResolvedValue({ id: entityId }),
    analyze: vi.fn().mockResolvedValue({ id: entityId }),
    preparePayout: vi.fn().mockResolvedValue({ id: entityId }),
    reconcilePayoutItem: vi.fn().mockResolvedValue({ id: entityId }),
    payslip: vi.fn().mockResolvedValue({ id: entityId }),
    payslips: vi.fn().mockResolvedValue([{ id: entityId }]),
  };
}

describe('PayrollController', () => {
  it('validates and delegates every payroll route', async () => {
    const payroll = service();
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    const request = principal();
    await controller.importPayroll(request, organizationId, {
      reference: 'SYNTHETIC-1',
      assetId: 'mock:base:usdc',
      synthetic: true,
      perEmployeeCapAtomic: '1000000',
      batchCapAtomic: '2000000',
      csv: 'fixture',
    });
    await controller.batches(organizationId);
    await controller.batch(request, organizationId, entityId);
    await controller.auditView(
      request,
      organizationId,
      entityId,
      'Quarterly payroll control review',
    );
    await controller.approve(request, organizationId, entityId, {
      expectedManifestDigest: 'a'.repeat(64),
      expectedVersion: 1,
    });
    await controller.analyze(request, organizationId, entityId, {
      mode: 'deterministic',
    });
    await controller.preparePayout(
      request,
      organizationId,
      entityId,
      'payroll-1',
      { signerAccountId: 'payer.testnet' },
    );
    await controller.reconcilePayoutItem(
      request,
      organizationId,
      entityId,
      entityId,
      { transactionHash: '1'.repeat(43) },
    );
    expect(payroll.importSynthetic).toHaveBeenCalledWith(
      organizationId,
      userId,
      expect.objectContaining({ synthetic: true }),
    );
    expect(payroll.batches).toHaveBeenCalledWith(organizationId);
    expect(payroll.auditView).toHaveBeenCalledWith(
      organizationId,
      entityId,
      userId,
      'Quarterly payroll control review',
    );
    expect(payroll.analyze).toHaveBeenCalledWith(
      organizationId,
      entityId,
      userId,
      'deterministic',
    );
    expect(payroll.preparePayout).toHaveBeenCalledWith(
      organizationId,
      entityId,
      userId,
      'payer.testnet',
      'payroll-1',
    );
    expect(payroll.reconcilePayoutItem).toHaveBeenCalledWith(
      organizationId,
      entityId,
      entityId,
      userId,
      '1'.repeat(43),
    );
  });

  it('rejects extra or malformed import fields before the service', async () => {
    const payroll = service();
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    await expect(
      controller.importPayroll(principal(), organizationId, {
        reference: 'SYNTHETIC-1',
        assetId: 'mock:base:usdc',
        synthetic: true,
        perEmployeeCapAtomic: '1.5',
        batchCapAtomic: '2000000',
        csv: 'fixture',
        livePayout: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payroll.importSynthetic).not.toHaveBeenCalled();
  });

  it('rejects a malformed batch identifier before the service', async () => {
    const payroll = service();
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    await expect(
      controller.batch(principal(), organizationId, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payroll.batch).not.toHaveBeenCalled();
  });

  it.each<[PayrollErrorCode, new (...args: never[]) => Error]>([
    ['PAYROLL_NOT_FOUND', NotFoundException],
    ['PAYROLL_PAYOUT_NOT_FOUND', NotFoundException],
    ['PAYROLL_ACCESS_DENIED', ForbiddenException],
    ['PRIVATE_AI_DISABLED', ServiceUnavailableException],
    ['PRIVATE_AI_UNAVAILABLE', ServiceUnavailableException],
    ['PAYROLL_PAYOUT_DISABLED', ServiceUnavailableException],
    ['PAYROLL_DUPLICATE', ConflictException],
    ['PAYROLL_MANIFEST_MISMATCH', ConflictException],
    ['PAYROLL_NOT_APPROVABLE', ConflictException],
    ['PAYROLL_PAYOUT_NOT_READY', ConflictException],
    ['PAYROLL_PAYOUT_CONFLICT', ConflictException],
    ['PAYROLL_INVALID_IMPORT', BadRequestException],
    ['PRIVATE_AI_UNVERIFIED', BadRequestException],
    ['PRIVATE_AI_RESPONSE_INVALID', BadRequestException],
  ])('maps %s to the expected HTTP error', async (code, Expected) => {
    const payroll = service();
    payroll.batch.mockRejectedValueOnce(new PayrollError(code, 'fixture'));
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    await expect(
      controller.batch(principal(), organizationId, entityId),
    ).rejects.toBeInstanceOf(Expected);
  });

  it('maps payout provider failures without exposing adapter errors', async () => {
    const payroll = service();
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    payroll.reconcilePayoutItem.mockRejectedValueOnce(
      new ProviderAdapterError('PROVIDER_UNAVAILABLE', 'fixture'),
    );
    await expect(
      controller.reconcilePayoutItem(
        principal(),
        organizationId,
        entityId,
        entityId,
        { transactionHash: '1'.repeat(43) },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    payroll.reconcilePayoutItem.mockRejectedValueOnce(
      new ProviderAdapterError('TRANSFER_EVIDENCE_MISMATCH', 'fixture'),
    );
    await expect(
      controller.reconcilePayoutItem(
        principal(),
        organizationId,
        entityId,
        entityId,
        { transactionHash: '1'.repeat(43) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed payout material before calling the service', async () => {
    const payroll = service();
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    await expect(
      controller.preparePayout(
        principal(),
        organizationId,
        entityId,
        undefined,
        { signerAccountId: 'INVALID ACCOUNT' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.reconcilePayoutItem(
        principal(),
        organizationId,
        entityId,
        entityId,
        { transactionHash: 'not-a-hash' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payroll.preparePayout).not.toHaveBeenCalled();
    expect(payroll.reconcilePayoutItem).not.toHaveBeenCalled();
  });

  it('does not mask unexpected errors', async () => {
    const payroll = service();
    const failure = new TypeError('fixture');
    payroll.batch.mockRejectedValueOnce(failure);
    const controller = new PayrollController(
      payroll as unknown as PayrollService,
    );
    await expect(
      controller.batch(principal(), organizationId, entityId),
    ).rejects.toBe(failure);
  });
});

describe('PayslipController', () => {
  it('delegates a self-only read and maps hidden records to 404', async () => {
    const payroll = service();
    const controller = new PayslipController(
      payroll as unknown as PayrollService,
    );
    await expect(controller.payslips(principal())).resolves.toEqual([
      { id: entityId },
    ]);
    expect(payroll.payslips).toHaveBeenCalledWith(userId);
    await expect(controller.payslip(principal(), entityId)).resolves.toEqual({
      id: entityId,
    });
    expect(payroll.payslip).toHaveBeenCalledWith(userId, entityId);
    payroll.payslip.mockRejectedValueOnce(
      new PayrollError('PAYROLL_NOT_FOUND', 'hidden'),
    );
    await expect(
      controller.payslip(principal(), entityId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not mask unexpected payslip errors', async () => {
    const payroll = service();
    const failure = new Error('fixture');
    payroll.payslip.mockRejectedValueOnce(failure);
    const controller = new PayslipController(
      payroll as unknown as PayrollService,
    );
    await expect(controller.payslip(principal(), entityId)).rejects.toBe(
      failure,
    );
  });

  it('rejects a malformed line identifier before the service', async () => {
    const payroll = service();
    const controller = new PayslipController(
      payroll as unknown as PayrollService,
    );
    await expect(
      controller.payslip(principal(), 'not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(payroll.payslip).not.toHaveBeenCalled();
  });
});
