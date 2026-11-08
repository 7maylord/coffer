import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnvironment } from './load-env.js';

describe('loadLocalEnvironment', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const key = 'COFFER_ENV_LOADER_TEST';

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    delete process.env[key];
  });

  it('loads a local file and tolerates a missing one outside production', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coffer-env-'));
    const path = join(directory, '.env');
    writeFileSync(path, `${key}=loaded\n`);
    delete process.env.NODE_ENV;

    expect(() =>
      loadLocalEnvironment(join(directory, 'missing')),
    ).not.toThrow();
    loadLocalEnvironment(path);

    expect(process.env[key]).toBe('loaded');
    rmSync(directory, { recursive: true });
  });

  it('does not load a file when production is set externally', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coffer-env-'));
    const path = join(directory, '.env');
    writeFileSync(path, `${key}=loaded\n`);
    process.env.NODE_ENV = 'production';

    loadLocalEnvironment(path);

    expect(process.env[key]).toBeUndefined();
    rmSync(directory, { recursive: true });
  });
});
