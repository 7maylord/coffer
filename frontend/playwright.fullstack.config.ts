import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  process.env.FULLSTACK_DATABASE_URL ??
  "postgresql://coffer:coffer_local@localhost:5433/coffer_dev";

export default defineConfig({
  testDir: "./tests/fullstack",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "pnpm --dir ../backend start",
      url: "http://127.0.0.1:4100/health/live",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        API_HOST: "127.0.0.1",
        API_PORT: "4100",
        WEB_URL: "http://127.0.0.1:3101",
        DATABASE_URL: databaseUrl,
        REDIS_URL: "redis://localhost:6379",
        SETTLEMENT_MODE: "mock",
        LIVE_TRANSFERS_ENABLED: "false",
        NEAR_TESTNET_TRANSFERS_ENABLED: "false",
        NEAR_INTENTS_DRY_QUOTES_ENABLED: "false",
        NEAR_INTENTS_WET_QUOTES_ENABLED: "false",
      },
    },
    {
      command: "pnpm exec next dev --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { COFFER_API_URL: "http://127.0.0.1:4100" },
    },
  ],
});
