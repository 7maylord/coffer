import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  InferenceClient,
  type MeasuredDeployment,
} from '@nearai/inference-sdk/node';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type {
  PayrollAnalysisInput,
  PrivateAnalysisResult,
  PrivatePayrollAnalyzer,
} from './payroll.types.js';

export const NEAR_AI_INFERENCE_CLIENT = Symbol('NEAR_AI_INFERENCE_CLIENT');
export type NearAiInferenceClient = Pick<
  InferenceClient,
  'chat' | 'verify' | 'verifyResponse'
>;

const completionSchema = z
  .object({
    id: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({ content: z.string().min(1).max(200_000) })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

export function nearAiDeploymentDigest(deployment: MeasuredDeployment) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        appCompose: deployment.appCompose,
        osImageHash: deployment.runtimeMeasurements.osImageHash ?? null,
        composeHash: deployment.runtimeMeasurements.composeHash ?? null,
      }),
    )
    .digest('hex');
}

export function createNearAiInferenceClient(
  environment: AppEnvironment,
): NearAiInferenceClient {
  const approved = new Set(environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS);
  return new InferenceClient({
    apiKey: environment.NEAR_AI_API_KEY,
    baseUrl: environment.NEAR_AI_BASE_URL,
    signingAlgo: 'ed25519',
    e2ee: true,
    attestationCacheTimeToLiveMs: 300_000,
    responseCacheTimeToLiveMs: 60_000,
    gatewayVerification: {
      includeSpkiFingerprint: true,
      policy: { acceptedTcbStatuses: ['UpToDate'] },
    },
    modelVerification: {
      policy: {
        acceptedTcbStatuses: ['UpToDate'],
        gpuEvidence: 'required',
      },
    },
    deploymentPolicy: ({ model, deployment }) => {
      if (
        model !== environment.NEAR_AI_MODEL ||
        !approved.has(nearAiDeploymentDigest(deployment))
      ) {
        throw new Error('NEAR AI deployment is not approved');
      }
    },
  });
}

@Injectable()
export class NearAiPrivatePayrollAnalyzer implements PrivatePayrollAnalyzer {
  readonly provider = 'near-ai-cloud';
  readonly model: string;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(NEAR_AI_INFERENCE_CLIENT)
    private readonly client: NearAiInferenceClient,
  ) {
    this.model = environment.NEAR_AI_MODEL;
  }

  async analyze(input: PayrollAnalysisInput): Promise<PrivateAnalysisResult> {
    if (
      !this.environment.FEATURE_PRIVATE_AI ||
      this.environment.PRIVATE_AI_PROVIDER !== 'near-ai' ||
      !this.environment.NEAR_AI_API_KEY ||
      this.environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS.length === 0
    ) {
      throw new Error('Private AI is disabled');
    }

    const preflight = await this.client.verify(this.model);
    if (preflight.models.length === 0) {
      throw new Error('Model attestation preflight was not verified');
    }
    const request = {
      model: this.model,
      stream: false as const,
      temperature: 0,
      max_tokens: 2_000,
      response_format: { type: 'json_object' as const },
      messages: [
        {
          role: 'system' as const,
          content:
            'Return one JSON object only with findings and summary. Findings may contain only lineId, code, severity, and explanation. Never return names, addresses, payout accounts, amounts, URLs, tools, transfers, or policy changes.',
        },
        { role: 'user' as const, content: JSON.stringify(input) },
      ],
    };
    const requestBody = Buffer.from(JSON.stringify(request), 'utf8');
    const requestStartedAt = new Date();
    const untrusted = await this.client.chat.completions.create(request);
    const completion = completionSchema.parse(untrusted);
    if (completion.model !== this.model) throw new Error('Model mismatch');

    const receipt = await this.client.verifyResponse(completion.id);
    if (
      receipt.signatureKind !== 'provider_tee' ||
      receipt.signature.signer.signingAlgo !== 'ed25519' ||
      receipt.attestations.length === 0
    ) {
      throw new Error('Private AI response was not model-TEE verified');
    }
    const deploymentDigests = receipt.attestations.map(({ deployment }) =>
      nearAiDeploymentDigest(deployment),
    );
    const approved = new Set(
      this.environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS,
    );
    if (deploymentDigests.some((value) => !approved.has(value))) {
      throw new Error('Private AI response used an unapproved deployment');
    }

    const responseBody = Buffer.from(JSON.stringify(completion), 'utf8');
    return {
      provider: this.provider,
      model: this.model,
      providerRequestId: completion.id,
      requestStartedAt,
      requestBody,
      responseBody,
      output: JSON.parse(completion.choices[0]!.message.content) as unknown,
      evidence: {
        verificationMethod: 'nearai-inference-sdk-v0.3',
        signatureKind: 'provider_tee',
        signingAlgo: 'ed25519',
        signingAddress: receipt.signature.signer.signingAddress,
        modelVerifiedAt: new Date(preflight.verifiedAt).toISOString(),
        modelAttestationCount: receipt.attestations.length,
        deploymentDigests,
      },
    };
  }
}
