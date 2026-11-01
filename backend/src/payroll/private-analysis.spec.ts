import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { NearAiPayrollAttestationVerifier } from './private-analysis.js';
import type { PrivateAnalysisResult } from './payroll.types.js';

function fixture(): PrivateAnalysisResult {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32);
  const request = Buffer.from('{"request":1}');
  const response = Buffer.from('{"response":1}');
  const model = 'fixture/model';
  const text = `${model}:${hash(request)}:${hash(response)}`;
  const started = new Date('2026-10-30T12:00:00.000Z');
  return {
    provider: 'near-ai-cloud',
    model,
    requestStartedAt: started,
    exactRequestBody: request,
    exactResponseBody: response,
    output: { findings: [], summary: 'fixture' },
    evidence: {
      signatureKind: 'provider_tee',
      signingAlgo: 'ed25519',
      signingAddress: rawPublicKey.toString('hex'),
      text,
      signatureHex: sign(null, Buffer.from(text), privateKey).toString('hex'),
      verifiedModelReports: [
        {
          signingAddress: rawPublicKey.toString('hex'),
          signingAlgo: 'ed25519',
          reportDigest: 'a'.repeat(64),
          verifiedAt: '2026-10-30T11:59:00.000Z',
          verificationMethod: 'intel-dcap+measurements-v1',
        },
      ],
    },
  };
}

describe('NearAiPayrollAttestationVerifier', () => {
  const verifier = new NearAiPayrollAttestationVerifier();

  it('accepts exact bytes signed by exactly one preflight model report', () => {
    expect(verifier.verify(fixture())).toBe(true);
  });

  it.each([
    [
      'response bytes',
      (value: PrivateAnalysisResult) => {
        value.exactResponseBody = Buffer.from('{}');
      },
    ],
    [
      'signature',
      (value: PrivateAnalysisResult) => {
        value.evidence!.signatureHex = '0'.repeat(128);
      },
    ],
    [
      'signature kind',
      (value: PrivateAnalysisResult) => {
        value.evidence!.signatureKind = 'gateway';
      },
    ],
    [
      'preflight signer',
      (value: PrivateAnalysisResult) => {
        value.evidence!.verifiedModelReports[0]!.signingAddress = 'b'.repeat(
          64,
        );
      },
    ],
    [
      'preflight timing',
      (value: PrivateAnalysisResult) => {
        value.evidence!.verifiedModelReports[0]!.verifiedAt =
          '2026-10-30T12:01:00.000Z';
      },
    ],
  ])('T-PRV-07 rejects tampered %s', (_label, tamper) => {
    const value = fixture();
    tamper(value);
    expect(verifier.verify(value)).toBe(false);
  });
});

function hash(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
