import { spawnSync } from 'node:child_process';

describe('local database reset guard', () => {
  it.each([
    ['postgresql://user:pass@database.example/localhost', 'development'],
    ['postgresql://user:pass@localhost/postgres', 'development'],
    ['postgresql://user:pass@localhost/coffer_dev', 'production'],
  ])('refuses unsafe target %s in %s', (databaseUrl, nodeEnv) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/reset-local-database.mjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          NODE_ENV: nodeEnv,
          CONFIRM_LOCAL_DB_RESET: 'yes',
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to reset/);
  });
});
