import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { SettlementOutboxWorker } from './settlement/settlement-outbox.worker.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const worker = app.get(SettlementOutboxWorker);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopping) {
    try {
      if (!(await worker.drainOnce())) await delay(1000);
    } catch {
      // The PostgreSQL lease records a safe retry code; provider payloads and
      // connection details must not be written to process logs.
      await delay(1000);
    }
  }
  await app.close();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main();
