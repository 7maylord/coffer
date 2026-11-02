import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { createOpenApiDocument } from '../src/openapi.js';

const outputPath = fileURLToPath(
  new URL('../../docs/api/openapi.json', import.meta.url),
);
const app = await NestFactory.create(AppModule, {
  logger: false,
  abortOnError: false,
});

try {
  await app.init();
  const serialized = `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== serialized) {
      throw new Error(
        'Generated OpenAPI is stale. Run pnpm --dir backend openapi:generate.',
      );
    }
  } else {
    await writeFile(outputPath, serialized, 'utf8');
  }
} finally {
  await app.close();
}
