import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';
import {
  AutomationError,
  type AutomationErrorCode,
} from './automation.types.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';

function principalRequest(): AuthenticatedRequest {
  return {
    [AUTH_PRINCIPAL]: {
      sessionId: 'session-1',
      userId,
      nearAccountId: 'operator.testnet',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    },
  } as unknown as AuthenticatedRequest;
}

function service() {
  return {
    createCfoProposal: vi.fn().mockResolvedValue({ id: entityId }),
    cfoProposal: vi.fn().mockResolvedValue({ id: entityId }),
    decideCfoProposal: vi.fn().mockResolvedValue({ id: entityId }),
    createAgent: vi.fn().mockResolvedValue({ id: entityId }),
    agents: vi.fn().mockResolvedValue([]),
    revokeAgent: vi.fn().mockResolvedValue({ id: entityId }),
    requestOffer: vi.fn().mockResolvedValue({ id: entityId }),
    createPurchaseProposal: vi.fn().mockResolvedValue({ id: entityId }),
    purchase: vi.fn().mockResolvedValue({ id: entityId }),
    executePurchase: vi.fn().mockResolvedValue({ id: entityId }),
  };
}

describe('AutomationController', () => {
  it('validates and delegates every bounded automation route', async () => {
    const automation = service();
    const controller = new AutomationController(
      automation as unknown as AutomationService,
    );
    const request = principalRequest();

    await controller.createCfo(request, organizationId, {
      sourceAccountId: entityId,
      assetId: 'mock:base:usdc',
      maximumAmountAtomic: '1000000',
      allowedCategories: ['Operations'],
      supportingRecordIds: [entityId],
    });
    await controller.getCfo(organizationId, entityId);
    await controller.decideCfo(request, organizationId, entityId, {
      decision: 'APPROVED',
      note: 'Reviewed',
    });
    await controller.createAgent(request, organizationId, {
      purpose: 'Classify documents',
      allowedActions: ['purchase:document-classification'],
      assetId: 'mock:base:usdc',
      chainId: 'mock:base',
      maxAmountAtomic: '1000000',
      rollingBudgetAtomic: '5000000',
      vendorAllowlist: ['mock-document-classifier'],
      expiresAt: '2026-11-01T00:00:00.000Z',
    });
    await controller.agents(organizationId);
    await controller.revokeAgent(organizationId, entityId);
    await controller.requestOffer(organizationId, entityId, {
      serviceCode: 'document-classification',
      documentCount: 2,
      classificationProfile: 'financial',
    });
    await controller.createPurchase(request, organizationId, entityId, {
      offerId: entityId,
    });
    await controller.getPurchase(organizationId, entityId);
    await controller.executePurchase(organizationId, entityId);

    expect(automation.createAgent).toHaveBeenCalledWith(
      organizationId,
      userId,
      expect.objectContaining({ rollingWindowSeconds: 86_400 }),
    );
    expect(automation.createPurchaseProposal).toHaveBeenCalledWith(
      organizationId,
      userId,
      entityId,
      entityId,
    );
    expect(automation.executePurchase).toHaveBeenCalledWith(
      organizationId,
      entityId,
    );
  });

  it('rejects unknown input fields before invoking a vendor', async () => {
    const automation = service();
    const controller = new AutomationController(
      automation as unknown as AutomationService,
    );
    await expect(
      controller.requestOffer(organizationId, entityId, {
        serviceCode: 'document-classification',
        documentCount: 1,
        classificationProfile: 'standard',
        url: 'http://169.254.169.254/latest/meta-data',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(automation.requestOffer).not.toHaveBeenCalled();
  });

  it('requires an authenticated principal before accepting actor-owned work', async () => {
    const automation = service();
    const controller = new AutomationController(
      automation as unknown as AutomationService,
    );
    await expect(
      controller.createPurchase(
        {} as AuthenticatedRequest,
        organizationId,
        entityId,
        { offerId: entityId },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(automation.createPurchaseProposal).not.toHaveBeenCalled();
  });

  it.each<[AutomationErrorCode, new (...args: never[]) => Error]>([
    ['AUTOMATION_NOT_FOUND', NotFoundException],
    ['AGENT_DISABLED', ServiceUnavailableException],
    ['AI_PROVIDER_UNAVAILABLE', ServiceUnavailableException],
    ['AGENT_INACTIVE', ForbiddenException],
    ['VENDOR_NOT_ALLOWED', ForbiddenException],
    ['PURCHASE_DUPLICATE', ConflictException],
    ['OFFER_EXPIRED', ConflictException],
    ['PURCHASE_NOT_EXECUTABLE', ConflictException],
    ['OFFER_INVALID', BadRequestException],
    ['PURCHASE_BUDGET_EXCEEDED', BadRequestException],
  ])('maps %s to the expected HTTP error', async (code, Expected) => {
    const automation = service();
    automation.cfoProposal.mockRejectedValueOnce(
      new AutomationError(code, 'fixture'),
    );
    const controller = new AutomationController(
      automation as unknown as AutomationService,
    );
    await expect(
      controller.getCfo(organizationId, entityId),
    ).rejects.toBeInstanceOf(Expected);
  });

  it('does not mask unexpected programming errors', async () => {
    const automation = service();
    const failure = new TypeError('fixture bug');
    automation.cfoProposal.mockRejectedValueOnce(failure);
    const controller = new AutomationController(
      automation as unknown as AutomationService,
    );
    await expect(controller.getCfo(organizationId, entityId)).rejects.toBe(
      failure,
    );
  });
});
