import type { MeasuredDeployment } from '@nearai/inference-sdk/node';
import { parseEnvironment } from '../config/env.js';
import {
  nearAiDeploymentDigest,
  type NearAiInferenceClient,
} from '../payroll/near-ai-private.adapter.js';
import { NearAiCfoInferenceAdapter } from './ai-adapters.js';

const deployment: MeasuredDeployment = {
  appCompose: 'services:\n  model:\n    image: fixture@sha256:abc',
  runtimeMeasurements: {
    osImageHash: 'os-fixture',
    composeHash: 'compose-fixture',
  },
};
const deploymentDigest = nearAiDeploymentDigest(deployment);
const input = {
  assetId: 'mock:base:usdc',
  maximumAmountAtomic: '1000000',
  allowedCategories: ['Operations'],
  records: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'invoice' as const,
      assetId: 'mock:base:usdc',
      amountAtomic: '1000000',
      status: 'ISSUED',
    },
  ],
};

const environment = () =>
  parseEnvironment({
    AI_CFO_PROVIDER: 'near-ai',
    NEAR_AI_CFO_ENABLED: 'true',
    NEAR_AI_API_KEY: 'server-only-test-key',
    NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS: deploymentDigest,
  });

function client(
  options: {
    models?: unknown[];
    model?: string;
    signatureKind?: string;
    deployment?: MeasuredDeployment;
  } = {},
) {
  return {
    verify: vi.fn().mockResolvedValue({
      models: options.models ?? [{ deployment }],
      verifiedAt: Date.now(),
    }),
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          id: 'completion-1',
          model: options.model ?? 'z-ai/glm-5.3-flash',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  allocations: [],
                  summary: 'fixture',
                }),
              },
            },
          ],
        }),
      },
    },
    verifyResponse: vi.fn().mockResolvedValue({
      signatureKind: options.signatureKind ?? 'provider_tee',
      signature: {
        signer: { signingAlgo: 'ed25519', signingAddress: 'a'.repeat(64) },
      },
      attestations: [{ deployment: options.deployment ?? deployment }],
    }),
  } as unknown as NearAiInferenceClient;
}

describe('NearAiCfoInferenceAdapter', () => {
  it('uses verified E2EE inference with scoped data and no tools', async () => {
    const sdk = client();
    const adapter = new NearAiCfoInferenceAdapter(environment(), sdk);

    await expect(adapter.infer(input)).resolves.toMatchObject({
      provider: 'near-ai-cloud',
      model: 'z-ai/glm-5.3-flash',
      providerRequestId: 'completion-1',
      attestationStatus: 'VERIFIED_PROVIDER_TEE',
    });
    expect(sdk.verify).toHaveBeenCalledWith('z-ai/glm-5.3-flash');
    expect(sdk.verifyResponse).toHaveBeenCalledWith('completion-1');
    const request = vi.mocked(sdk.chat.completions.create).mock.calls[0]![0];
    expect(request).not.toHaveProperty('tools');
    expect(JSON.stringify(request)).not.toContain('customer');
  });

  it('fails closed before inference when attestation preflight is empty', async () => {
    const sdk = client({ models: [] });
    const adapter = new NearAiCfoInferenceAdapter(environment(), sdk);
    await expect(adapter.infer(input)).rejects.toThrow('preflight');
    expect(sdk.chat.completions.create).not.toHaveBeenCalled();
  });

  it('fails closed on model, receipt, and deployment mismatches', async () => {
    await expect(
      new NearAiCfoInferenceAdapter(
        environment(),
        client({ model: 'provider/other-model' }),
      ).infer(input),
    ).rejects.toThrow('model mismatch');
    await expect(
      new NearAiCfoInferenceAdapter(
        environment(),
        client({ signatureKind: 'gateway' }),
      ).infer(input),
    ).rejects.toThrow('model-TEE');
    await expect(
      new NearAiCfoInferenceAdapter(
        environment(),
        client({
          deployment: { appCompose: 'unapproved', runtimeMeasurements: {} },
        }),
      ).infer(input),
    ).rejects.toThrow('unapproved deployment');
  });

  it('fails when disabled', async () => {
    const adapter = new NearAiCfoInferenceAdapter(
      parseEnvironment({}),
      client(),
    );
    await expect(adapter.infer(input)).rejects.toThrow('disabled');
  });
});
