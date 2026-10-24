import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { correlationId, SafeExceptionFilter } from './request-safety.js';

describe('request safety', () => {
  it('generates distinct local IDs and ignores supplied headers', () => {
    const response = { locals: {}, setHeader: vi.fn(), once: vi.fn() };
    const next = vi.fn();
    correlationId(
      { headers: { 'x-correlation-id': 'forged' } } as unknown as Request,
      response as unknown as Response,
      next,
    );
    const first = response.setHeader.mock.calls[0]?.[1];
    correlationId({} as Request, response as unknown as Response, next);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(response.setHeader.mock.calls[1]?.[1]);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Error('secret-password'),
    new BadRequestException({
      message: 'secret-password',
      details: 'private salary',
    }),
  ])('never serializes exception data', (error) => {
    const response = {
      locals: { correlationId: 'test-id' },
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new SafeExceptionFilter().catch(error, host);
    const body = JSON.stringify(response.json.mock.calls);
    expect(body).not.toContain('secret-password');
    expect(body).not.toContain('private salary');
    expect(body).toContain('test-id');
    expect(response.status).toHaveBeenCalledWith(
      error instanceof BadRequestException ? 400 : 500,
    );
  });
});
