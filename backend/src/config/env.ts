import { z } from 'zod';

const disabled = z
  .enum(['false'])
  .default('false')
  .transform(() => false);
const featureFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).max(16_384).optional(),
);
const optionalNearAccount = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
    .optional(),
);
const optionalNearHash = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/)
    .optional(),
);
const deploymentDigests = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim()
      ? value.split(',').map((entry) => entry.trim())
      : [],
  z
    .array(z.string().regex(/^[0-9a-f]{64}$/))
    .min(0)
    .max(20),
);
const serviceUrl = (protocols: string[]) =>
  z
    .string()
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return protocols.includes(url.protocol) && !!url.hostname && !url.hash;
    });

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    // Keep the unauthenticated development shell on loopback until B-02 ships.
    API_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    WEB_URL: serviceUrl(['http:', 'https:']).default('http://localhost:3000'),
    DATABASE_URL: serviceUrl(['postgresql:', 'postgres:']).default(
      'postgresql://coffer:coffer_local@localhost:5433/coffer_dev',
    ),
    REDIS_URL: serviceUrl(['redis:', 'rediss:']).default(
      'redis://localhost:6379',
    ),
    SETTLEMENT_MODE: z.literal('mock').default('mock'),
    LIVE_TRANSFERS_ENABLED: featureFlag,
    NEAR_TESTNET_TRANSFERS_ENABLED: featureFlag,
    NEAR_INTENTS_DRY_QUOTES_ENABLED: featureFlag,
    NEAR_INTENTS_WET_QUOTES_ENABLED: featureFlag,
    NEAR_INTENTS_PROVIDER: z
      .enum(['one-click', 'tidepool'])
      .default('one-click'),
    FEATURE_CONFIDENTIAL_SWAPS: featureFlag,
    FEATURE_NATIVE_POLICY_CONTRACT: disabled,
    FEATURE_AGENT_EXECUTION: featureFlag,
    NEAR_AI_CFO_ENABLED: featureFlag,
    AI_CFO_PROVIDER: z.enum(['mock', 'near-ai']).default('mock'),
    FEATURE_PRIVATE_AI: featureFlag,
    PRIVATE_AI_PROVIDER: z
      .enum(['unavailable', 'near-ai'])
      .default('unavailable'),
    FEATURE_PAYROLL_BATCH_PAYOUT: featureFlag,
    FEATURE_MULTI_TENANT_BILLING: disabled,
    STRICT_TEE_ATTESTATION: z
      .literal('true')
      .default('true')
      .transform(() => true),
    NEAR_NETWORK: z.literal('testnet').default('testnet'),
    NEAR_RPC_URL: serviceUrl(['https:']).default(
      'https://test.rpc.fastnear.com',
    ),
    NEAR_INTENTS_API_URL: serviceUrl(['https:']).default(
      'https://1click.chaindefuser.com',
    ),
    NEAR_INTENTS_API_KEY: optionalSecret,
    NEAR_INTENTS_JWT: optionalSecret,
    NEAR_TEST_TOKEN_CONTRACT_ID: optionalNearAccount,
    NEAR_TEST_TOKEN_CODE_HASH: optionalNearHash,
    NEAR_POLICY_FACTORY_ACCOUNT_ID: optionalNearAccount,
    NEAR_POLICY_FACTORY_CODE_HASH: optionalNearHash,
    NEAR_POLICY_PROVISIONER_ACCOUNT_ID: optionalNearAccount,
    NEAR_POLICY_CODE_HASH: optionalNearHash,
    NEAR_AI_BASE_URL: serviceUrl(['https:']).default(
      'https://cloud-api.near.ai/v1',
    ),
    NEAR_AI_API_KEY: optionalSecret,
    NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS: deploymentDigests,
    ENCRYPTION_KEY_BASE64: optionalSecret,
    ENCRYPTION_KEY_VERSION: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .default('local-ephemeral-v1'),
    NEAR_AI_MODEL: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
      .default('z-ai/glm-5.3-flash'),
  })
  .superRefine((value, context) => {
    if (value.NEAR_INTENTS_API_KEY && value.NEAR_INTENTS_JWT) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_INTENTS_API_KEY'],
        message: 'Configure only one NEAR Intents credential',
      });
    }
    if (
      value.NEAR_INTENTS_PROVIDER === 'tidepool' &&
      new URL(value.NEAR_INTENTS_API_URL).origin !==
        'https://www.usetidepool.tech'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_INTENTS_API_URL'],
        message: 'Tidepool provider requires its pinned public origin',
      });
    }
    if (
      value.LIVE_TRANSFERS_ENABLED &&
      !value.NEAR_TESTNET_TRANSFERS_ENABLED &&
      !value.NEAR_INTENTS_WET_QUOTES_ENABLED
    ) {
      context.addIssue({
        code: 'custom',
        path: ['LIVE_TRANSFERS_ENABLED'],
        message: 'Live transfers require an explicitly enabled adapter',
      });
    }
    if (
      value.NEAR_INTENTS_WET_QUOTES_ENABLED &&
      (!value.NEAR_INTENTS_DRY_QUOTES_ENABLED || !value.LIVE_TRANSFERS_ENABLED)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_INTENTS_WET_QUOTES_ENABLED'],
        message: 'Wet quotes require dry quotes and live transfers',
      });
    }
    if (
      value.FEATURE_CONFIDENTIAL_SWAPS &&
      !value.NEAR_INTENTS_WET_QUOTES_ENABLED
    ) {
      context.addIssue({
        code: 'custom',
        path: ['FEATURE_CONFIDENTIAL_SWAPS'],
        message: 'Confidential swaps require wet Intents quotes',
      });
    }
    if (value.NEAR_TESTNET_TRANSFERS_ENABLED && !value.LIVE_TRANSFERS_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_TESTNET_TRANSFERS_ENABLED'],
        message: 'Testnet transfers require the global live gate',
      });
    }
    if (
      value.FEATURE_PAYROLL_BATCH_PAYOUT &&
      (!value.LIVE_TRANSFERS_ENABLED || !value.NEAR_TESTNET_TRANSFERS_ENABLED)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['FEATURE_PAYROLL_BATCH_PAYOUT'],
        message: 'Payroll payouts require the gated testnet transfer adapter',
      });
    }
    if (
      value.AI_CFO_PROVIDER === 'near-ai' &&
      (!value.NEAR_AI_CFO_ENABLED ||
        !value.NEAR_AI_API_KEY ||
        value.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS.length === 0 ||
        new URL(value.NEAR_AI_BASE_URL).origin !== 'https://cloud-api.near.ai')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AI_CFO_PROVIDER'],
        message:
          'NEAR AI CFO requires its feature flag, server API key, pinned provider, and approved deployment digest',
      });
    }
    if (value.NEAR_AI_CFO_ENABLED && value.AI_CFO_PROVIDER !== 'near-ai') {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_AI_CFO_ENABLED'],
        message: 'NEAR AI CFO flag requires the near-ai provider',
      });
    }
    if (
      value.FEATURE_PRIVATE_AI &&
      (value.PRIVATE_AI_PROVIDER !== 'near-ai' ||
        !value.NEAR_AI_API_KEY ||
        !value.ENCRYPTION_KEY_BASE64 ||
        value.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS.length === 0 ||
        new URL(value.NEAR_AI_BASE_URL).origin !== 'https://cloud-api.near.ai')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['FEATURE_PRIVATE_AI'],
        message:
          'Private AI requires the direct NEAR AI provider, API key, persistent encryption key, and approved deployment digest',
      });
    }
    if (
      value.NEAR_TESTNET_TRANSFERS_ENABLED &&
      Boolean(value.NEAR_TEST_TOKEN_CONTRACT_ID) !==
        Boolean(value.NEAR_TEST_TOKEN_CODE_HASH)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_TEST_TOKEN_CODE_HASH'],
        message:
          'Test token contract and code hash must be configured together',
      });
    }
    const factorySettings = [
      value.NEAR_POLICY_FACTORY_ACCOUNT_ID,
      value.NEAR_POLICY_FACTORY_CODE_HASH,
      value.NEAR_POLICY_PROVISIONER_ACCOUNT_ID,
      value.NEAR_POLICY_CODE_HASH,
    ];
    if (
      factorySettings.some(Boolean) &&
      factorySettings.some((setting) => !setting)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_POLICY_FACTORY_ACCOUNT_ID'],
        message: 'Policy factory settings must be configured together',
      });
    }
    if (
      value.NEAR_POLICY_FACTORY_ACCOUNT_ID &&
      value.NEAR_POLICY_FACTORY_ACCOUNT_ID.length > 31
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NEAR_POLICY_FACTORY_ACCOUNT_ID'],
        message: 'Policy factory account ID exceeds the contract limit',
      });
    }
  });

export type AppEnvironment = z.infer<typeof envSchema>;
export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');

export function parseEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  const result = envSchema.safeParse({
    ...input,
    API_PORT: input.API_PORT ?? input.PORT,
  });
  if (!result.success) {
    // Zod issues can include submitted values. Only schema-owned field names escape.
    throw new Error(
      `Invalid configuration: ${[...new Set(result.error.issues.map((issue) => issue.path[0]))].join(', ')}`,
    );
  }
  return result.data;
}
