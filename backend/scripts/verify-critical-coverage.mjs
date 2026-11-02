import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const reportPath = resolve(backendRoot, 'coverage', 'coverage-final.json');
const criticalFiles = new Set([
  'src/auth/auth.service.ts',
  'src/auth/auth.guards.ts',
  'src/auth/session-cookie.ts',
  'src/treasury/money.ts',
  'src/treasury/asset-registry.ts',
  'src/policy/policy-engine.ts',
  'src/policy/proposal-digest.ts',
  'src/settlement/mock-settlement.adapter.ts',
]);
const minimumBranches = 90;

let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch {
  console.error('Coverage report is unavailable; run `pnpm test:cov` first.');
  process.exit(1);
}

let covered = 0;
let total = 0;
const found = new Set();
for (const [absolutePath, entry] of Object.entries(report)) {
  const path = relative(backendRoot, absolutePath).split(sep).join('/');
  if (!criticalFiles.has(path)) continue;
  found.add(path);
  const branches = Object.values(entry.b ?? {}).flat();
  covered += branches.filter((hits) => hits > 0).length;
  total += branches.length;
}

const missing = [...criticalFiles].filter((path) => !found.has(path));
if (missing.length > 0 || total === 0) {
  console.error(`Critical coverage report is missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const percentage = (covered / total) * 100;
  const summary = `${covered}/${total} branches (${percentage.toFixed(2)}%)`;
  if (percentage < minimumBranches) {
    console.error(
      `Critical branch coverage ${summary} is below ${minimumBranches}%.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Critical branch coverage passed: ${summary}.`);
  }
}
