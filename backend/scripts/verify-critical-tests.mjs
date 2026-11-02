import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const required = [
  ...range('T-ID', 1, 8),
  ...range('T-LED', 1, 7),
  ...range('T-POL', 1, 6),
  ...range('T-AI', 1, 5),
  ...range('T-PAY', 1, 12),
  ...range('T-PRV', 1, 10),
  ...range('T-AGT', 1, 6),
];

const files = [
  ...(await collectSpecFiles(join(backendRoot, 'src'))),
  ...(await collectSpecFiles(join(backendRoot, 'test'))),
];
const evidence = new Map(required.map((id) => [id, []]));

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const id of required) {
    if (source.includes(id)) evidence.get(id).push(relative(backendRoot, file));
  }
}

const missing = required.filter((id) => evidence.get(id).length === 0);
if (missing.length > 0) {
  console.error(`Critical test manifest is missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(
    `Critical test manifest passed: ${required.length} required PRD test IDs are explicit across ${files.length} test files.`,
  );
}

function range(prefix, start, end) {
  return Array.from(
    { length: end - start + 1 },
    (_, index) => `${prefix}-${String(start + index).padStart(2, '0')}`,
  );
}

async function collectSpecFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSpecFiles(path);
      if (
        entry.isFile() &&
        extname(entry.name) === '.ts' &&
        (entry.name.endsWith('.spec.ts') ||
          entry.name.endsWith('.integration-spec.ts') ||
          entry.name.endsWith('.e2e-spec.ts'))
      ) {
        return [path];
      }
      return [];
    }),
  );
  return nested.flat();
}
