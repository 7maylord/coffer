import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  PayrollAnalysisInput,
  PayrollAttestationVerifier,
  PrivateAnalysisResult,
  PrivatePayrollAnalyzer,
} from './payroll.types.js';

@Injectable()
export class UnavailablePrivatePayrollAnalyzer implements PrivatePayrollAnalyzer {
  readonly provider = 'near-ai-cloud';
  readonly model = 'unavailable';

  analyze(_input: PayrollAnalysisInput): Promise<PrivateAnalysisResult> {
    return Promise.reject(
      new Error('Verified private inference adapter is unavailable'),
    );
  }
}

@Injectable()
export class NearAiPayrollAttestationVerifier implements PayrollAttestationVerifier {
  verify(result: PrivateAnalysisResult): boolean {
    const evidence = result.evidence;
    if (
      !evidence ||
      evidence.signatureKind !== 'provider_tee' ||
      evidence.signingAlgo !== 'ed25519' ||
      !/^[0-9a-f]{64}$/.test(evidence.signingAddress) ||
      !/^[0-9a-f]{128}$/.test(evidence.signatureHex)
    ) {
      return false;
    }
    const reports = evidence.verifiedModelReports.filter(
      (report) =>
        report.signingAlgo === 'ed25519' &&
        report.signingAddress === evidence.signingAddress &&
        report.verificationMethod === 'intel-dcap+measurements-v1' &&
        /^[0-9a-f]{64}$/.test(report.reportDigest) &&
        Date.parse(report.verifiedAt) <= result.requestStartedAt.getTime(),
    );
    if (reports.length !== 1) return false;
    const requestHash = hash(result.exactRequestBody);
    const responseHash = hash(result.exactResponseBody);
    const expected = `${result.model}:${requestHash}:${responseHash}`;
    if (evidence.text !== expected) return false;
    try {
      const rawPublicKey = Buffer.from(evidence.signingAddress, 'hex');
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          rawPublicKey,
        ]),
        format: 'der',
        type: 'spki',
      });
      return verifySignature(
        null,
        Buffer.from(expected, 'utf8'),
        publicKey,
        Buffer.from(evidence.signatureHex, 'hex'),
      );
    } catch {
      return false;
    }
  }
}

function hash(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
