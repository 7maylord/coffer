import { parseEnvironment } from '../config/env.js';
import { NearAiCfoInferenceAdapter } from './ai-adapters.js';

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

describe('NearAiCfoInferenceAdapter', () => {
  const environment = () =>
    parseEnvironment({
      AI_CFO_PROVIDER: 'near-ai',
      NEAR_AI_CFO_ENABLED: 'true',
      NEAR_AI_API_KEY: 'server-only-test-key',
    });

  it('sends only structured scoped data with no tools and flags unverified evidence', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          id: 'completion-1',
          model: 'z-ai/glm-5.3-flash',
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
        { status: 200, headers: { 'x-request-id': 'request-1' } },
      );
    };
    const adapter = new NearAiCfoInferenceAdapter(environment(), fetcher);

    await expect(adapter.infer(input)).resolves.toMatchObject({
      provider: 'near-ai-cloud',
      model: 'z-ai/glm-5.3-flash',
      providerRequestId: 'request-1',
      attestationStatus: 'UNVERIFIED',
    });
    expect(capturedUrl).toBe('https://cloud-api.near.ai/v1/chat/completions');
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('x-no-aliasing')).toBe('true');
    expect(headers.get('authorization')).toBe('Bearer server-only-test-key');
    const body = JSON.parse(String(capturedInit?.body)) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('tools');
    expect(JSON.stringify(body)).not.toContain('customer');
  });

  it('fails closed when disabled or the provider changes the model', async () => {
    const disabled = new NearAiCfoInferenceAdapter(parseEnvironment({}));
    await expect(disabled.infer(input)).rejects.toThrow('disabled');

    const mismatched: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: 'completion-2',
          model: 'provider/other-model',
          choices: [{ message: { content: '{}' } }],
        }),
      );
    const adapter = new NearAiCfoInferenceAdapter(environment(), mismatched);
    await expect(adapter.infer(input)).rejects.toThrow('model mismatch');
  });

  it.each([
    [
      'network failure',
      async () => {
        throw new Error('timeout');
      },
      'request failed',
    ],
    [
      'HTTP failure',
      async () => new Response('unavailable', { status: 503 }),
      'HTTP 503',
    ],
    [
      'malformed envelope JSON',
      async () => new Response('{'),
      'malformed JSON',
    ],
    [
      'malformed message JSON',
      async () =>
        new Response(
          JSON.stringify({
            id: 'completion-3',
            model: 'z-ai/glm-5.3-flash',
            choices: [{ message: { content: 'not-json' } }],
          }),
        ),
      'message was not JSON',
    ],
    [
      'oversized response',
      async () =>
        new Response('{}', { headers: { 'content-length': '1000001' } }),
      'response too large',
    ],
  ] as const)('fails closed on %s', async (_label, fetcher, expected) => {
    const adapter = new NearAiCfoInferenceAdapter(
      environment(),
      fetcher as typeof fetch,
    );
    await expect(adapter.infer(input)).rejects.toThrow(expected);
  });
});
