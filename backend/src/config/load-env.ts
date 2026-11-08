import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../../.env', import.meta.url));

export function loadLocalEnvironment(path = defaultPath): void {
  if (process.env.NODE_ENV === 'production') return;
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}
