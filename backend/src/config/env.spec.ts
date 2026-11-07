import { parseEnvironment } from './env.js';

describe('environment safety', () => {
  it.each([
    { SETTLEMENT_MODE: 'near-intents' },
    { SETTLEMENT_MODE: 'near-testnet' },
    { NODE_ENV: 'production' },
    { API_HOST: '0.0.0.0' },
    { API_PORT: '0' },
    { API_PORT: '65536' },
    { API_PORT: '1.5' },
    { DATABASE_URL: 'https://example.test' },
    { REDIS_URL: 'file:///tmp/private' },
    { NEAR_NETWORK: 'mainnet' },
    { STRICT_TEE_ATTESTATION: 'false' },
    { FEATURE_PRIVATE_AI: 'true' },
    { FEATURE_NATIVE_POLICY_CONTRACT: 'true' },
    { FEATURE_PAYROLL_BATCH_PAYOUT: 'true' },
    { FEATURE_MULTI_TENANT_BILLING: 'true' },
    { NEAR_TESTNET_TRANSFERS_ENABLED: 'true' },
    { NEAR_INTENTS_WET_QUOTES_ENABLED: 'true' },
    { FEATURE_CONFIDENTIAL_SWAPS: 'true' },
  ])('rejects unsupported or unsafe configuration: %o', (input) => {
    expect(() => parseEnvironment(input)).toThrow('Invalid configuration:');
  });

  it('never puts connection credentials in configuration errors', () => {
    expect(() => parseEnvironment({ DATABASE_URL: 'password-secret' })).toThrow(
      'Invalid configuration: DATABASE_URL',
    );
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'https://user:password-secret@example.test',
      }),
    ).toThrow('Invalid configuration: DATABASE_URL');
  });
  it('defaults to mock settlement with live transfers disabled', () => {
    const result = parseEnvironment({});

    expect(result.SETTLEMENT_MODE).toBe('mock');
    expect(result.LIVE_TRANSFERS_ENABLED).toBe(false);
  });

  it('requires the reviewed factory, provisioner and policy hashes together', () => {
    expect(() =>
      parseEnvironment({
        NEAR_POLICY_FACTORY_ACCOUNT_ID: 'factory.olymight.testnet',
      }),
    ).toThrow('Invalid configuration: NEAR_POLICY_FACTORY_ACCOUNT_ID');
    expect(
      parseEnvironment({
        NEAR_POLICY_FACTORY_ACCOUNT_ID: 'factory.olymight.testnet',
        NEAR_POLICY_FACTORY_CODE_HASH:
          'DpSNraj7RMxNiJiTY7zPA3NfoC9Qx3MWgiERgBG5gM5A',
        NEAR_POLICY_PROVISIONER_ACCOUNT_ID: 'olymight.testnet',
        NEAR_POLICY_CODE_HASH: 'EtQLEkEdF82iifMe68RdFBYC4YWPh3oGMskuM2w7AhJj',
      }),
    ).toMatchObject({
      NEAR_POLICY_FACTORY_ACCOUNT_ID: 'factory.olymight.testnet',
    });
  });

  it('fails closed when live transfers are enabled in mock mode', () => {
    expect(() =>
      parseEnvironment({
        SETTLEMENT_MODE: 'mock',
        LIVE_TRANSFERS_ENABLED: 'true',
      }),
    ).toThrow();
  });

  it('allows read-only Intents discovery and dry quotes without a live gate', () => {
    expect(
      parseEnvironment({ NEAR_INTENTS_DRY_QUOTES_ENABLED: 'true' }),
    ).toMatchObject({
      LIVE_TRANSFERS_ENABLED: false,
      NEAR_INTENTS_DRY_QUOTES_ENABLED: true,
      NEAR_INTENTS_WET_QUOTES_ENABLED: false,
    });
  });

  it('keeps mock automation explicit and requires credentials for NEAR AI', () => {
    expect(parseEnvironment({ FEATURE_AGENT_EXECUTION: 'true' })).toMatchObject(
      {
        FEATURE_AGENT_EXECUTION: true,
        AI_CFO_PROVIDER: 'mock',
        NEAR_AI_CFO_ENABLED: false,
      },
    );
    expect(() => parseEnvironment({ AI_CFO_PROVIDER: 'near-ai' })).toThrow(
      'Invalid configuration: AI_CFO_PROVIDER',
    );
    expect(
      parseEnvironment({
        AI_CFO_PROVIDER: 'near-ai',
        NEAR_AI_CFO_ENABLED: 'true',
        NEAR_AI_API_KEY: 'server-only-test-key',
      }),
    ).toMatchObject({
      AI_CFO_PROVIDER: 'near-ai',
      NEAR_AI_CFO_ENABLED: true,
    });
  });

  it('requires both adapter and global gates for wet or testnet transfers', () => {
    expect(
      parseEnvironment({
        LIVE_TRANSFERS_ENABLED: 'true',
        NEAR_TESTNET_TRANSFERS_ENABLED: 'true',
        NEAR_TEST_TOKEN_CONTRACT_ID: 'token.coffer.testnet',
        NEAR_TEST_TOKEN_CODE_HASH:
          '11111111111111111111111111111111111111111111',
      }),
    ).toMatchObject({
      LIVE_TRANSFERS_ENABLED: true,
      NEAR_TESTNET_TRANSFERS_ENABLED: true,
    });
    expect(
      parseEnvironment({
        LIVE_TRANSFERS_ENABLED: 'true',
        NEAR_INTENTS_DRY_QUOTES_ENABLED: 'true',
        NEAR_INTENTS_WET_QUOTES_ENABLED: 'true',
      }),
    ).toMatchObject({
      LIVE_TRANSFERS_ENABLED: true,
      NEAR_INTENTS_WET_QUOTES_ENABLED: true,
    });
  });

  it('does not allow mock mode to claim confidential swaps', () => {
    expect(() =>
      parseEnvironment({
        SETTLEMENT_MODE: 'mock',
        FEATURE_CONFIDENTIAL_SWAPS: 'true',
      }),
    ).toThrow();
  });
  it.each(['yes', '1', '', 'TRUE', 'tru'])(
    'rejects malformed feature flags: %s',
    (value) => {
      expect(() =>
        parseEnvironment({ LIVE_TRANSFERS_ENABLED: value }),
      ).toThrow();
      expect(() =>
        parseEnvironment({ FEATURE_CONFIDENTIAL_SWAPS: value }),
      ).toThrow();
      expect(() =>
        parseEnvironment({ NEAR_INTENTS_DRY_QUOTES_ENABLED: value }),
      ).toThrow();
    },
  );
});
