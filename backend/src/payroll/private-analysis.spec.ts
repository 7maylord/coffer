import { parseEnvironment } from '../config/env.js';
import { NearAiPayrollAttestationVerifier } from './private-analysis.js';
import type { PrivateAnalysisResult } from './payroll.types.js';

const deploymentDigest = 'a'.repeat(64);
const environment = parseEnvironment({
  NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS: deploymentDigest,
});

function fixture(): PrivateAnalysisResult {
  return {
    provider: 'near-ai-cloud',
    model: 'fixture/model',
    requestStartedAt: new Date('2026-10-30T12:00:00.000Z'),
    requestBody: Buffer.from('{"request":1}'),
    responseBody: Buffer.from('{"response":1}'),
    output: { findings: [], summary: 'fixture' },
    evidence: {
      verificationMethod: 'nearai-inference-sdk-v0.3',
      signatureKind: 'provider_tee',
      signingAlgo: 'ed25519',
      signingAddress: 'b'.repeat(64),
      modelVerifiedAt: '2026-10-30T11:59:00.000Z',
      modelAttestationCount: 1,
      deploymentDigests: [deploymentDigest],
    },
  };
}

describe('NearAiPayrollAttestationVerifier', () => {
  const verifier = new NearAiPayrollAttestationVerifier(environment);

  it('accepts a provider-TEE receipt from an approved verified deployment', () => {
    expect(verifier.verify(fixture())).toBe(true);
  });

  it.each([
    [
      'deployment',
      (value: PrivateAnalysisResult) => {
        value.evidence!.deploymentDigests = ['c'.repeat(64)];
      },
    ],
    [
      'signer',
      (value: PrivateAnalysisResult) => {
        value.evidence!.signingAddress = 'invalid';
      },
    ],
    [
      'attestation count',
      (value: PrivateAnalysisResult) => {
        value.evidence!.modelAttestationCount = 2;
      },
    ],
    [
      'preflight timing',
      (value: PrivateAnalysisResult) => {
        value.evidence!.modelVerifiedAt = '2026-10-30T12:01:00.000Z';
      },
    ],
  ])('T-PRV-07 rejects altered %s evidence', (_label, alter) => {
    const value = fixture();
    alter(value);
    expect(verifier.verify(value)).toBe(false);
  });
});
