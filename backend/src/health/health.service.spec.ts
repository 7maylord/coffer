import { HealthService, deadline } from './health.service.js';
import { HealthController } from './health.controller.js';

describe('dependency health', () => {
  it('coalesces parallel probes and checks again after recovery', async () => {
    const dependencies = {
      postgres: vi.fn().mockResolvedValue(undefined),
      redis: vi.fn().mockRejectedValue(new Error('secret connection URL')),
    };
    const health = new HealthService(dependencies);
    const controller = new HealthController(health);
    expect(controller.live()).toEqual({ status: 'ok' });
    await expect(controller.ready()).rejects.toThrow('Service Unavailable');
    dependencies.redis.mockResolvedValue(undefined);
    const first = health.ready();
    expect(health.ready()).toBe(first);
    await expect(first).resolves.toBe(true);
    await expect(controller.ready()).resolves.toEqual({ status: 'ready' });
    expect(dependencies.postgres).toHaveBeenCalledTimes(3);
  });

  it.each(['postgres', 'redis'] as const)(
    'fails closed for %s failure',
    async (dependency) => {
      const dependencies = {
        postgres: vi.fn().mockResolvedValue(undefined),
        redis: vi.fn().mockResolvedValue(undefined),
      };
      dependencies[dependency].mockRejectedValue(new Error('private-host'));
      await expect(new HealthService(dependencies).ready()).resolves.toBe(
        false,
      );
    },
  );

  it('bounds a hung dependency and clears timers on rejection or success', async () => {
    vi.useFakeTimers();
    try {
      const result = deadline(new Promise<never>(() => {}), 20);
      const assertion = expect(result).rejects.toThrow('Dependency timeout');
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
      await expect(deadline(Promise.resolve(1))).resolves.toBe(1);
      await expect(
        deadline(Promise.reject(new Error('failure'))),
      ).rejects.toThrow('failure');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
