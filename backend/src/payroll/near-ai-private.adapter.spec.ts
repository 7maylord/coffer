import { parseEnvironment } from '../config/env.js';
import { NearAiPrivatePayrollAnalyzer } from './near-ai-private.adapter.js';
import type { NearAiModelReportVerifier } from './payroll.types.js';

const environment = () =>
  parseEnvironment({
    FEATURE_PRIVATE_AI: 'true',
    PRIVATE_AI_PROVIDER: 'near-ai',
    NEAR_AI_API_KEY: 'test-api-key',
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

describe('NearAiPrivatePayrollAnalyzer', () => {
  it('fails before sending payroll when every preflight report is not verified', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ model_attestations: [{ intel_quote: 'x' }] }),
        ),
      );
    const reportVerifier: NearAiModelReportVerifier = {
      verify: vi.fn().mockResolvedValue([]),
    };
    const adapter = new NearAiPrivatePayrollAnalyzer(
      environment(),
      reportVerifier,
      fetcher,
    );
    await expect(adapter.analyze(input)).rejects.toThrow('preflight');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toContain('/attestation/report');
  });

  it('preserves exact request and response bytes after verified preflight', async () => {
    const signingAddress = 'a'.repeat(64);
    const responses = [
      new Response(
        JSON.stringify({ model_attestations: [{ intel_quote: 'x' }] }),
      ),
      new Response(
        JSON.stringify({
          id: 'chat-1',
          model: 'zai-org/GLM-5.1-FP8',
          choices: [
            {
              message: {
                content: JSON.stringify({ findings: [], summary: 'fixture' }),
              },
            },
          ],
        }),
        { headers: { 'x-request-id': 'request-1' } },
      ),
      new Response(
        JSON.stringify({
          signature_kind: 'provider_tee',
          signing_algo: 'ed25519',
          signing_address: signingAddress,
          text: 'fixture',
          signature: 'b'.repeat(128),
        }),
      ),
    ];
    const fetcher = vi.fn().mockImplementation(async () => responses.shift()!);
    const reportVerifier: NearAiModelReportVerifier = {
      verify: vi.fn().mockResolvedValue([
        {
          signingAddress,
          signingAlgo: 'ed25519',
          reportDigest: 'c'.repeat(64),
          verifiedAt: '2026-10-30T00:00:00.000Z',
          verificationMethod: 'intel-dcap+measurements-v1',
        },
      ]),
    };
    const adapter = new NearAiPrivatePayrollAnalyzer(
      environment(),
      reportVerifier,
      fetcher,
    );
    const result = await adapter.analyze(input);
    expect(result).toMatchObject({
      providerRequestId: 'request-1',
      evidence: { signatureKind: 'provider_tee' },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.exactRequestBody.toString()).toContain('1000000');
    expect(result.exactRequestBody.toString()).not.toContain('legalName');
  });
});
