import { parseEnvironment } from '../src/config/env.js';
import {
  HealthDependencies,
  HealthService,
} from '../src/health/health.service.js';

describe('local dependency readiness', () => {
  it('probes real PostgreSQL and Redis and closes connections', async () => {
    const dependencies = new HealthDependencies(parseEnvironment());
    try {
      expect(await new HealthService(dependencies).ready()).toBe(true);
    } finally {
      await dependencies.onModuleDestroy();
    }
  });

  it('fails on unreachable services within a bounded time', async () => {
    const dependencies = new HealthDependencies(
      parseEnvironment({
        DATABASE_URL: 'postgresql://fake:fake@127.0.0.1:1/fake',
        REDIS_URL: 'redis://127.0.0.1:1',
      }),
    );
    try {
      expect(await new HealthService(dependencies).ready()).toBe(false);
    } finally {
      await dependencies.onModuleDestroy();
    }
  });
});
