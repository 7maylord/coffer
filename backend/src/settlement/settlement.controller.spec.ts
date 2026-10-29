import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MockSettlementAdapter } from './mock-settlement.adapter.js';
import { SettlementController } from './settlement.controller.js';

const validRequest = {
  sourceAssetId: 'mock:base:usdc',
  destinationAssetId: 'mock:near:usdc',
  amountAtomic: '12500000',
  recipient: 'merchant.near',
  refundTo: 'payer.near',
  slippageBps: 50,
  confidentiality: 'none',
  scenario: 'success',
} as const;

describe('SettlementController', () => {
  let controller: SettlementController;

  beforeEach(() => {
    let sequence = 0;
    controller = new SettlementController(
      new MockSettlementAdapter({
        now: () => new Date('2026-10-29T00:00:00.000Z'),
        idFactory: (prefix) => `${prefix}_${++sequence}`,
      }),
    );
  });

  it('exposes mock assets and accepts exact atomic string amounts', async () => {
    expect(controller.supportedAssets()).toEqual({
      mode: 'mock',
      assets: expect.arrayContaining([
        expect.objectContaining({ id: 'mock:base:usdc', decimals: 6 }),
      ]),
    });

    const quote = await controller.createQuote('org_1', validRequest);
    expect(quote).toMatchObject({
      organizationId: 'org_1',
      amountAtomic: '12500000',
      confidentiality: 'none',
      scenario: 'success',
    });
  });

  it('applies safe defaults and rejects malformed request bodies', async () => {
    const {
      confidentiality: _confidentiality,
      scenario: _scenario,
      ...body
    } = validRequest;
    await expect(controller.createQuote('org_1', body)).resolves.toMatchObject({
      confidentiality: 'none',
      scenario: 'success',
    });

    await expect(
      controller.createQuote('org_1', {
        ...validRequest,
        amountAtomic: 12.5,
        unexpected: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('maps adapter validation errors to safe bad requests', async () => {
    await expect(
      controller.createQuote('org_1', {
        ...validRequest,
        destinationAssetId: validRequest.sourceAssetId,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      controller.initiate('org_1', undefined, { quoteId: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('maps organization-scoped missing resources to 404', async () => {
    await expect(controller.getAttempt('org_1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.poll('org_1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('replays an identical request and rejects conflicting idempotency use', async () => {
    const firstQuote = await controller.createQuote('org_1', validRequest);
    const first = await controller.initiate('org_1', 'same-key', {
      quoteId: firstQuote.id,
    });
    await expect(
      controller.initiate('org_1', 'same-key', { quoteId: firstQuote.id }),
    ).resolves.toEqual(first);
    await expect(controller.getAttempt('org_1', first.id)).resolves.toEqual(
      first,
    );

    const secondQuote = await controller.createQuote('org_1', {
      ...validRequest,
      amountAtomic: '2',
    });
    await expect(
      controller.initiate('org_1', 'same-key', { quoteId: secondQuote.id }),
    ).rejects.toThrow(ConflictException);
  });

  it('polls a payment through the mock lifecycle', async () => {
    const quote = await controller.createQuote('org_1', validRequest);
    const attempt = await controller.initiate('org_1', 'payment-1', {
      quoteId: quote.id,
    });
    await expect(controller.poll('org_1', attempt.id)).resolves.toMatchObject({
      status: 'DEPOSIT_OBSERVED',
    });
  });
});
