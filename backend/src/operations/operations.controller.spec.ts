import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import { OperationsController } from './operations.controller.js';
import { PrismaOperationsStore, redact } from './prisma-operations.store.js';
import { OperationsError } from './operations.types.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const caseId = '33333333-3333-4333-8333-333333333333';

function request(): AuthenticatedRequest {
  return {
    [AUTH_PRINCIPAL]: {
      sessionId: 'session',
      userId: actorId,
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      wallets: [],
      memberships: [{ organizationId, role: 'OWNER' }],
    },
  } as unknown as AuthenticatedRequest;
}

function service() {
  return {
    audit: vi.fn().mockResolvedValue({ events: [] }),
    dashboard: vi.fn().mockResolvedValue({ queued: [] }),
    metrics: vi.fn().mockResolvedValue({ queuedOutboxEvents: 0 }),
    recheck: vi.fn().mockResolvedValue({ status: 'QUEUED' }),
  };
}

describe('OperationsController', () => {
  it('validates and delegates audit, dashboard, metrics, and recheck routes', async () => {
    const operations = service();
    const controller = new OperationsController(
      operations as unknown as PrismaOperationsStore,
    );
    await controller.audit(
      organizationId,
      '25',
      undefined,
      'PAYMENT_STATUS_CHANGED',
    );
    await controller.dashboard(organizationId, '10');
    await controller.metrics(organizationId);
    await controller.recheck(request(), organizationId, caseId, 'recheck-1');
    expect(operations.audit).toHaveBeenCalledWith(organizationId, {
      limit: 25,
      cursor: undefined,
      eventType: 'PAYMENT_STATUS_CHANGED',
    });
    expect(operations.dashboard).toHaveBeenCalledWith(organizationId, 10);
    expect(operations.recheck).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        caseId,
        actorUserId: actorId,
        idempotencyKey: 'recheck-1',
      }),
    );
  });

  it('rejects malformed pagination, identifiers, and idempotency keys', async () => {
    const operations = service();
    const controller = new OperationsController(
      operations as unknown as PrismaOperationsStore,
    );
    await expect(
      controller.dashboard(organizationId, '101'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.recheck(request(), organizationId, 'bad-id', 'key'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.recheck(request(), organizationId, caseId, ''),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(operations.recheck).not.toHaveBeenCalled();
  });

  it.each([
    ['OPERATIONS_NOT_FOUND', NotFoundException],
    ['IDEMPOTENCY_CONFLICT', ConflictException],
    ['RECONCILIATION_NOT_ACTIONABLE', BadRequestException],
    ['IDEMPOTENCY_REQUIRED', BadRequestException],
  ] as const)('maps %s to a safe HTTP error', async (code, Expected) => {
    const operations = service();
    operations.dashboard.mockRejectedValueOnce(
      new OperationsError(code, 'hidden'),
    );
    const controller = new OperationsController(
      operations as unknown as PrismaOperationsStore,
    );
    await expect(
      controller.dashboard(organizationId, '10'),
    ).rejects.toBeInstanceOf(Expected);
  });
});

describe('audit metadata redaction', () => {
  it('removes sensitive values recursively and bounds untrusted metadata', () => {
    expect(
      redact({
        paymentId: 'safe',
        salary: '1000000',
        nested: { payoutAccount: 'employee.testnet', note: 'x'.repeat(300) },
      }),
    ).toEqual({
      paymentId: 'safe',
      salary: '[REDACTED]',
      nested: { payoutAccount: '[REDACTED]', note: 'x'.repeat(256) },
    });
  });
});
