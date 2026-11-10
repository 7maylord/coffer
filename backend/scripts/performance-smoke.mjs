import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entrypoint = join(backendRoot, 'dist', 'main.js');
const requestCount = 250;
const concurrency = 25;
const maximumP95Milliseconds = 1_000;
const minimumRequestsPerSecond = 20;

if (!existsSync(entrypoint)) {
  console.error(
    'Built API is unavailable; run `pnpm build` before this smoke.',
  );
  process.exit(1);
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, [entrypoint], {
  cwd: backendRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    SETTLEMENT_MODE: 'mock',
    LIVE_TRANSFERS_ENABLED: 'false',
    NEAR_TESTNET_TRANSFERS_ENABLED: 'false',
    NEAR_INTENTS_DRY_QUOTES_ENABLED: 'false',
    NEAR_INTENTS_WET_QUOTES_ENABLED: 'false',
    FEATURE_AGENT_EXECUTION: 'false',
    FEATURE_PRIVATE_AI: 'false',
    FEATURE_PAYROLL_BATCH_PAYOUT: 'false',
    AI_CFO_PROVIDER: 'mock',
    NEAR_AI_CFO_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', capture);
child.stderr.on('data', capture);

try {
  await waitForLiveness();
  await Promise.all(Array.from({ length: concurrency }, requestLiveness));

  const durations = [];
  let next = 0;
  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requestCount) {
        next += 1;
        const requestStartedAt = performance.now();
        await requestLiveness();
        durations.push(performance.now() - requestStartedAt);
      }
    }),
  );
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  const requestsPerSecond = requestCount / elapsedSeconds;
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];

  console.log(
    `Performance smoke: ${requestCount} requests, ${concurrency} concurrent, ${requestsPerSecond.toFixed(1)} req/s, p95 ${p95.toFixed(1)} ms.`,
  );
  if (p95 > maximumP95Milliseconds) {
    throw new Error(`p95 exceeded ${maximumP95Milliseconds} ms`);
  }
  if (requestsPerSecond < minimumRequestsPerSecond) {
    throw new Error(`throughput fell below ${minimumRequestsPerSecond} req/s`);
  }
} catch (error) {
  console.error(`Performance smoke failed: ${error.message}`);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function capture(chunk) {
  if (output.length < 16_384) output += chunk.toString('utf8');
}

async function requestLiveness() {
  const response = await fetch(`${baseUrl}/health/live`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== 'ok') throw new Error('Unexpected liveness response');
}

async function waitForLiveness() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('API exited before startup');
    try {
      await requestLiveness();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('API did not become live within 10 seconds');
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
