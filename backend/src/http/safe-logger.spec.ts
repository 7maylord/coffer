import { randomUUID } from 'node:crypto';
import { SafeLogger } from './safe-logger.js';

describe('safe structured logging', () => {
  it('T-PRV-05 discards raw framework messages, payroll values, and credentials', () => {
    const sink = vi.fn();
    const logger = new SafeLogger(sink);
    for (const method of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      logger[method](
        new Error('salary-secret'),
        { password: 'credential-secret' },
        'Bearer token-secret',
      );
    }
    expect(sink).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /salary-secret|credential-secret|token-secret/,
    );
  });

  it('strips unknown fields and rejects forged metadata', () => {
    const sink = vi.fn();
    const logger = new SafeLogger(sink);
    const event = {
      event: 'http_request' as const,
      correlationId: randomUUID(),
      method: 'GET' as const,
      status: 200,
      durationMs: 3,
      body: { salary: 'secret' },
      url: '/private-token',
    };
    logger.write(event);
    expect(JSON.parse(sink.mock.calls[0]![0])).toEqual({
      event: 'http_request',
      correlationId: event.correlationId,
      method: 'GET',
      status: 200,
      durationMs: 3,
    });
    logger.write({ ...event, correlationId: 'forged\nsecret' });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
