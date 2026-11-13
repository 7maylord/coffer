import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './config/env.js';
import { loadLocalEnvironment } from './config/load-env.js';
import { safeLogger } from './http/safe-logger.js';
import { SettlementOutboxProcessor } from './settlement/settlement-outbox.processor.js';
import { FinanceAgentOutboxProcessor } from './automation/finance-agent-outbox.processor.js';

async function bootstrap() {
  loadLocalEnvironment();
  const environment = parseEnvironment();
  const app = await NestFactory.create(AppModule, {
    logger: safeLogger,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  await app.listen(environment.API_PORT, environment.API_HOST);
  app.get(SettlementOutboxProcessor).start();
  app.get(FinanceAgentOutboxProcessor).start();
  safeLogger.write({ event: 'application_ready', level: 'info' });
}
try {
  await bootstrap();
} catch {
  safeLogger.write({ event: 'startup_failed', level: 'error' });
  process.exitCode = 1;
}
