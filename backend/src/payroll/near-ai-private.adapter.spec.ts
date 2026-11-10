import type { MeasuredDeployment } from '@nearai/inference-sdk/node';
import { parseEnvironment } from '../config/env.js';
import {
  NearAiPrivatePayrollAnalyzer,
  nearAiDeploymentDigest,
  type NearAiInferenceClient,
} from './near-ai-private.adapter.js';

const deployment: MeasuredDeployment = {
  appCompose: 'services:\n  model:\n    image: fixture@sha256:abc',
  runtimeMeasurements: {
    osImageHash: 'os-fixture',
    composeHash: 'compose-fixture',
  },
};
const deploymentDigest = nearAiDeploymentDigest(deployment);
const environment = () =>
  parseEnvironment({
    FEATURE_PRIVATE_AI: 'true',
    PRIVATE_AI_PROVIDER: 'near-ai',
    NEAR_AI_API_KEY: 'test-api-key',
    NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS: deploymentDigest,
    ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 4).toString('base64'),
  });
const input = {
  batchId: '11111111-1111-4111-8111-111111111111',
  assetId: 'mock:base:usdc',
  lines: [
    {
      lineId: '22222222-2222-4222-8222-222222222222',
      grossAmountAtomic: '1000000',
    },
  ],
};

function client(options: { models?: unknown[]; signatureKind?: string } = {}) {
  return {
    verify: vi.fn().mockResolvedValue({
      models: options.models ?? [{ deployment }],
      verifiedAt: Date.now() - 1_000,
    }),
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          id: 'chat-1',
          model: 'z-ai/glm-5.3-flash',
          choices: [
            {
              message: {
                content: JSON.stringify({ findings: [], summary: 'fixture' }),
              },
            },
          ],
        }),
      },
    },
    verifyResponse: vi.fn().mockResolvedValue({
      id: 'chat-1',
      completionId: 'chat-1',
      signatureKind: options.signatureKind ?? 'provider_tee',
      signature: {
        signer: { signingAlgo: 'ed25519', signingAddress: 'a'.repeat(64) },
      },
      attestations: [{ deployment }],
    }),
  } as unknown as NearAiInferenceClient;
}

describe('NearAiPrivatePayrollAnalyzer', () => {
  it('fails before sending payroll when model preflight is not verified', async () => {
    const sdk = client({ models: [] });
    const adapter = new NearAiPrivatePayrollAnalyzer(environment(), sdk);
    await expect(adapter.analyze(input)).rejects.toThrow('preflight');
    expect(sdk.chat.completions.create).not.toHaveBeenCalled();
  });

  it('uses E2EE SDK preflight and accepts only a verified provider-TEE receipt', async () => {
    const sdk = client();
    const adapter = new NearAiPrivatePayrollAnalyzer(environment(), sdk);
    const result = await adapter.analyze(input);
    expect(result).toMatchObject({
      providerRequestId: 'chat-1',
      evidence: {
        verificationMethod: 'nearai-inference-sdk-v0.3',
        signatureKind: 'provider_tee',
        deploymentDigests: [deploymentDigest],
      },
    });
    expect(vi.mocked(sdk.verify).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sdk.chat.completions.create).mock.invocationCallOrder[0]!,
    );
    expect(sdk.verifyResponse).toHaveBeenCalledWith('chat-1');
    expect(result.requestBody.toString()).toContain('1000000');
    expect(result.requestBody.toString()).not.toContain('legalName');
  });

  it('rejects a gateway receipt for payroll analysis', async () => {
    const adapter = new NearAiPrivatePayrollAnalyzer(
      environment(),
      client({ signatureKind: 'gateway' }),
    );
    await expect(adapter.analyze(input)).rejects.toThrow('model-TEE');
  });
});
