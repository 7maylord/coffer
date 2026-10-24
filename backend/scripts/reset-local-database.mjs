import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL ?? '';
let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  process.stderr.write('DATABASE_URL must be a valid PostgreSQL URL.\n');
  process.exit(1);
}
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const databaseName = parsedDatabaseUrl.pathname.slice(1);
if (
  !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
  !localHosts.has(parsedDatabaseUrl.hostname) ||
  !databaseName ||
  ['postgres', 'template0', 'template1'].includes(databaseName)
) {
  process.stderr.write('Refusing to reset a non-local database.\n');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Refusing to reset while NODE_ENV=production.\n');
  process.exit(1);
}
if (process.env.CONFIRM_LOCAL_DB_RESET !== 'yes') {
  process.stderr.write(
    'Set CONFIRM_LOCAL_DB_RESET=yes to confirm the local-only reset.\n',
  );
  process.exit(1);
}

const reset = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'],
  { stdio: 'inherit', shell: false },
);
if (reset.status !== 0) process.exit(reset.status ?? 1);
const seed = spawnSync('pnpm', ['prisma:seed'], {
  stdio: 'inherit',
  shell: false,
});
process.exit(seed.status ?? 1);
