import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';

export async function deadline<T>(
  operation: Promise<T>,
  milliseconds = 2000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Dependency timeout')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthDependencies implements OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {
    const url = new URL(environment.DATABASE_URL);
    for (const key of [
      'connect_timeout',
      'pool_timeout',
      'socket_timeout',
      'connection_limit',
    ])
      url.searchParams.set(key, '2');
    this.prisma = new PrismaClient({
      datasourceUrl: url.toString(),
      log: [],
      errorFormat: 'minimal',
    });
  }

  async postgres(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async redis(): Promise<void> {
    const client = createClient({
      url: this.environment.REDIS_URL,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    client.on('error', () => {
      /* Readiness reports failure without exposing connection credentials. */
    });
    try {
      await deadline(
        (async () => {
          await client.connect();
          if ((await client.ping()) !== 'PONG')
            throw new Error('Dependency unavailable');
        })(),
      );
    } finally {
      if (client.isOpen) client.destroy();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Injectable()
export class HealthService {
  private pending?: Promise<boolean>;
  constructor(
    @Inject(HealthDependencies)
    private readonly dependencies: Pick<
      HealthDependencies,
      'postgres' | 'redis'
    >,
  ) {}

  ready(): Promise<boolean> {
    // Coalesce concurrent probes so an outage cannot exhaust connection pools.
    this.pending ??= Promise.allSettled([
      deadline(this.dependencies.postgres()),
      deadline(this.dependencies.redis()),
    ])
      .then((results) =>
        results.every((result) => result.status === 'fulfilled'),
      )
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
