import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './config/env.js';
import { safeLogger } from './http/safe-logger.js';

async function bootstrap() {
  const environment = parseEnvironment();
  const app = await NestFactory.create(AppModule, {
    logger: safeLogger,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  await app.listen(environment.API_PORT, environment.API_HOST);
  safeLogger.write({ event: 'application_ready', level: 'info' });
}
try {
  await bootstrap();
} catch {
  safeLogger.write({ event: 'startup_failed', level: 'error' });
  process.exitCode = 1;
}
