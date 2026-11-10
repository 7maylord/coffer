import { Inject, Injectable } from '@nestjs/common';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
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
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  verify(result: PrivateAnalysisResult): boolean {
    const evidence = result.evidence;
    const approved = new Set(
      this.environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS,
    );
    return Boolean(
      evidence &&
      evidence.verificationMethod === 'nearai-inference-sdk-v0.3' &&
      evidence.signatureKind === 'provider_tee' &&
      evidence.signingAlgo === 'ed25519' &&
      /^[0-9a-f]{64}$/.test(evidence.signingAddress) &&
      evidence.modelAttestationCount > 0 &&
      evidence.deploymentDigests.length === evidence.modelAttestationCount &&
      evidence.deploymentDigests.every(
        (value) => /^[0-9a-f]{64}$/.test(value) && approved.has(value),
      ) &&
      Date.parse(evidence.modelVerifiedAt) <= result.requestStartedAt.getTime(),
    );
  }
}
