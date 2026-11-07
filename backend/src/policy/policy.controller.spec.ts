// oxlint-disable typescript/unbound-method -- Vitest service methods are mock functions.
import { BadRequestException } from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { PolicyController } from './policy.controller.js';
import type { PolicyService } from './policy.service.js';
import type { PolicyFactoryService } from './policy-factory.service.js';

describe('PolicyController', () => {
  const service = {
    activate: vi.fn(),
    active: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    revise: vi.fn(),
    approve: vi.fn(),
    verifyForExecution: vi.fn(),
  } as unknown as PolicyService;
  const factory = {
    prepare: vi.fn(),
    previewSponsoredCall: vi.fn(),
    bind: vi.fn(),
  } as unknown as PolicyFactoryService;
  const controller = new PolicyController(service, factory);
  const principal: SessionPrincipal = {
    sessionId: 'session-id',
    userId: 'user-id',
    expiresAt: new Date(),
    wallets: [{ network: 'testnet', accountId: 'user.testnet' }],
    memberships: [{ organizationId: 'org-id', role: 'OWNER' }],
  };
  const request = { [AUTH_PRINCIPAL]: principal } as AuthenticatedRequest;
  const body = {
    proposalType: 'invoice_payment',
    chainId: 'near:testnet',
    assetId: 'mock:near:usdc',
    amountAtomic: '101',
    authorizedMaxAtomic: '101',
    recipientCommitment: 'a'.repeat(64),
    expiresAt: '2026-11-01T00:00:00.000Z',
    nonceCommitment: 'b'.repeat(64),
    idempotencyKeyCommitment: 'c'.repeat(64),
    operation: 'transfer',
    environment: 'testnet',
  };

  beforeEach(() => vi.clearAllMocks());

  it('routes policy activation and active reads through the session actor', async () => {
    vi.mocked(service.activate).mockResolvedValueOnce({
      id: 'policy-id',
    } as never);
    await expect(
      controller.activate(request, 'org-id', { rules: { frozen: false } }),
    ).resolves.toEqual({ id: 'policy-id' });
    expect(service.activate).toHaveBeenCalledWith('user-id', 'org-id', {
      frozen: false,
    });
    vi.mocked(service.active).mockResolvedValueOnce({
      id: 'policy-id',
    } as never);
    await expect(controller.active('org-id')).resolves.toEqual({
      id: 'policy-id',
    });
    expect(() => controller.activate(request, 'org-id', {})).toThrow(
      BadRequestException,
    );
  });

  it('validates, creates, reads, and revises proposal material', async () => {
    vi.mocked(service.create).mockResolvedValueOnce({
      id: 'proposal-id',
    } as never);
    await controller.create(request, 'org-id', body);
    expect(service.create).toHaveBeenCalledWith(
      'user-id',
      'org-id',
      expect.objectContaining({ expiresAt: new Date(body.expiresAt) }),
    );
    vi.mocked(service.get).mockResolvedValueOnce({
      id: 'proposal-id',
    } as never);
    await controller.get('org-id', 'proposal-id');
    expect(service.get).toHaveBeenCalledWith('org-id', 'proposal-id');
    vi.mocked(service.revise).mockResolvedValueOnce({
      id: 'revision-id',
    } as never);
    await controller.revise(request, 'org-id', 'proposal-id', body);
    expect(service.revise).toHaveBeenCalledWith(
      'user-id',
      'org-id',
      'proposal-id',
      expect.objectContaining({ amountAtomic: '101' }),
    );
    expect(() =>
      controller.create(request, 'org-id', { ...body, amountAtomic: '1.1' }),
    ).toThrow(BadRequestException);
  });

  it('approves with the principal and exposes execution verification', async () => {
    vi.mocked(service.approve).mockResolvedValueOnce({
      status: 'PENDING',
    } as never);
    await controller.approve(request, 'org-id', 'proposal-id', {
      nearAccountId: 'user.testnet',
    });
    expect(service.approve).toHaveBeenCalledWith(
      principal,
      'org-id',
      'proposal-id',
      'user.testnet',
    );
    vi.mocked(service.verifyForExecution).mockResolvedValueOnce({
      executable: true,
      verification: 'offchain',
    });
    await controller.verify('org-id', 'proposal-id');
    expect(service.verifyForExecution).toHaveBeenCalledWith(
      'org-id',
      'proposal-id',
    );
    expect(() =>
      controller.approve(request, 'org-id', 'proposal-id', {
        nearAccountId: '../attacker',
      }),
    ).toThrow(BadRequestException);
  });

  it('validates the sponsor preview and passes the authenticated owner', async () => {
    const selection = {
      controller: 'user.testnet',
      approvers: ['user.testnet', 'other.testnet'],
    };
    await controller.deploymentPreview(request, 'org-id', selection);
    expect(factory.previewSponsoredCall).toHaveBeenCalledWith(
      principal,
      'org-id',
      selection,
    );
    expect(() =>
      controller.deploymentPreview(request, 'org-id', {
        ...selection,
        approvers: ['../bad'],
      }),
    ).toThrow(BadRequestException);
  });
});
