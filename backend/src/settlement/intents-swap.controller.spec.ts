import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AUTH_PRINCIPAL,
  type AuthenticatedRequest,
} from '../auth/auth.guards.js';
import { IntentsSwapController } from './intents-swap.controller.js';
import { IntentsSwapService } from './intents-swap.service.js';
import { ProviderAdapterError } from './provider-adapter.types.js';
import { SettlementError } from './settlement.types.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const swapId = '22222222-2222-4222-8222-222222222222';
const transactionHash = '1'.repeat(43);
const input = {
  originAssetId: 'nep141:origin.testnet',
  destinationAssetId: 'nep141:destination.testnet',
  amountAtomic: '1000000',
  slippageBps: 100,
};

function request(
  wallets = [{ network: 'testnet', accountId: 'payer.testnet' }],
) {
  return {
    [AUTH_PRINCIPAL]: {
      sessionId: 'session-1',
      userId: '33333333-3333-4333-8333-333333333333',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      wallets,
      memberships: [{ organizationId, role: 'OWNER' }],
    },
  } as unknown as AuthenticatedRequest;
}

function service() {
  return {
    dryQuote: vi.fn().mockResolvedValue({ id: 'quote' }),
    prepare: vi.fn().mockResolvedValue({ id: swapId }),
    get: vi.fn().mockResolvedValue({ id: swapId }),
    submitDeposit: vi.fn().mockResolvedValue({ id: swapId }),
    poll: vi.fn().mockResolvedValue({ id: swapId }),
  };
}

describe('IntentsSwapController', () => {
  it('delegates every wallet-bound swap route', async () => {
    const swaps = service();
    const controller = new IntentsSwapController(
      swaps as unknown as IntentsSwapService,
    );
    const authenticated = request();

    await controller.dryQuote(authenticated, input);
    await controller.prepare(
      organizationId,
      authenticated,
      'swap-request-1',
      input,
    );
    await controller.prepare(organizationId, authenticated, undefined, input);
    await controller.get(organizationId, swapId, authenticated);
    await controller.submitDeposit(organizationId, swapId, authenticated, {
      transactionHash,
    });
    await controller.poll(organizationId, swapId, authenticated);

    expect(swaps.dryQuote).toHaveBeenCalledWith(input, 'payer.testnet');
    expect(swaps.prepare).toHaveBeenCalledWith(
      organizationId,
      '33333333-3333-4333-8333-333333333333',
      'payer.testnet',
      'swap-request-1',
      input,
    );
    expect(swaps.prepare).toHaveBeenLastCalledWith(
      organizationId,
      '33333333-3333-4333-8333-333333333333',
      'payer.testnet',
      '',
      input,
    );
    expect(swaps.submitDeposit).toHaveBeenCalledWith(
      organizationId,
      '33333333-3333-4333-8333-333333333333',
      'payer.testnet',
      swapId,
      transactionHash,
    );
  });

  it('rejects malformed input and sessions without a verified testnet wallet', async () => {
    const swaps = service();
    const controller = new IntentsSwapController(
      swaps as unknown as IntentsSwapService,
    );
    await expect(
      controller.dryQuote(request(), { ...input, amountAtomic: '1.5' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.dryQuote(
        request([{ network: 'mainnet', accountId: 'payer.near' }]),
        input,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(swaps.dryQuote).not.toHaveBeenCalled();
  });

  it.each([
    [new SettlementError('IDEMPOTENCY_CONFLICT', 'fixture'), ConflictException],
    [new SettlementError('PAYMENT_NOT_FOUND', 'fixture'), NotFoundException],
    [new SettlementError('QUOTE_EXPIRED', 'fixture'), BadRequestException],
    [
      new ProviderAdapterError('PROVIDER_UNAVAILABLE', 'fixture'),
      ServiceUnavailableException,
    ],
    [
      new ProviderAdapterError('PROVIDER_DISABLED', 'fixture'),
      ServiceUnavailableException,
    ],
    [
      new ProviderAdapterError('LIVE_OPERATION_DISABLED', 'fixture'),
      ServiceUnavailableException,
    ],
    [
      new ProviderAdapterError('PROVIDER_RESPONSE_INVALID', 'fixture'),
      BadGatewayException,
    ],
    [
      new ProviderAdapterError('PROVIDER_SIGNATURE_INVALID', 'fixture'),
      BadGatewayException,
    ],
    [
      new ProviderAdapterError('UNSUPPORTED_PROVIDER_ROUTE', 'fixture'),
      BadRequestException,
    ],
  ] as const)('maps %s to a safe HTTP exception', async (failure, Expected) => {
    const swaps = service();
    swaps.get.mockRejectedValueOnce(failure);
    const controller = new IntentsSwapController(
      swaps as unknown as IntentsSwapService,
    );
    await expect(
      controller.get(organizationId, swapId, request()),
    ).rejects.toBeInstanceOf(Expected);
  });

  it('does not mask an unexpected service failure', async () => {
    const swaps = service();
    const failure = new TypeError('fixture');
    swaps.get.mockRejectedValueOnce(failure);
    const controller = new IntentsSwapController(
      swaps as unknown as IntentsSwapService,
    );
    await expect(
      controller.get(organizationId, swapId, request()),
    ).rejects.toBe(failure);
  });
});
