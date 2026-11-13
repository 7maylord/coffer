import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  nearAiDeploymentDigest,
  NEAR_AI_INFERENCE_CLIENT,
  type NearAiInferenceClient,
} from '../payroll/near-ai-private.adapter.js';
import {
  type CfoInferenceAdapter,
  type CfoInferenceInput,
  type CfoInferenceResult,
} from './automation.types.js';

@Injectable()
export class MockCfoInferenceAdapter implements CfoInferenceAdapter {
  readonly provider = 'mock-cfo';
  readonly model = 'deterministic-allocation-v1';

  async infer(input: CfoInferenceInput): Promise<CfoInferenceResult> {
    const category = input.allowedCategories[0];
    if (!category) throw new Error('No allocation category');
    return {
      provider: this.provider,
      model: this.model,
      attestationStatus: 'NOT_REQUESTED',
      output: {
        allocations: [
          {
            category,
            amountAtomic: input.maximumAmountAtomic,
            reason: 'Deterministic local allocation fixture',
            supportingRecordIds: input.records.map(({ id }) => id),
            confidenceBps: 5000,
            uncertainty: 'Mock inference; no external model was used',
          },
        ],
        summary: 'Mock recommendation for workflow validation',
      },
    };
  }
}

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

@Injectable()
export class NearAiCfoInferenceAdapter implements CfoInferenceAdapter {
  readonly provider = 'near-ai-cloud';
  readonly model: string;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(NEAR_AI_INFERENCE_CLIENT)
    private readonly client: NearAiInferenceClient,
  ) {
    this.model = environment.NEAR_AI_MODEL;
  }

  async infer(input: CfoInferenceInput): Promise<CfoInferenceResult> {
    if (
      !this.environment.NEAR_AI_CFO_ENABLED ||
      this.environment.AI_CFO_PROVIDER !== 'near-ai' ||
      !this.environment.NEAR_AI_API_KEY ||
      this.environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS.length === 0
    ) {
      throw new Error('NEAR AI CFO inference is disabled');
    }
    const preflight = await this.client.verify(this.model);
    if (preflight.models.length === 0) {
      throw new Error('Model attestation preflight was not verified');
    }
    const request = {
      model: this.model,
      stream: false,
      temperature: 0,
      max_tokens: 2_000,
      response_format: { type: 'json_object' as const },
      messages: [
        {
          role: 'system' as const,
          content:
            'Return one JSON object only. Never request a payment, transfer, URL, tool call, account number, or policy override. Required shape: {"allocations":[{"category":string,"amountAtomic":positive integer string,"reason":string,"supportingRecordIds":string[],"confidenceBps":integer 0..10000,"uncertainty":string}],"summary":string}.',
        },
        { role: 'user' as const, content: JSON.stringify(input) },
      ],
    };
    const completion = completionSchema.safeParse(
      await this.client.chat.completions.create(request),
    );
    if (!completion.success || completion.data.model !== this.model) {
      throw new Error('NEAR AI completion schema or model mismatch');
    }
    const receipt = await this.client.verifyResponse(completion.data.id);
    if (
      receipt.signatureKind !== 'provider_tee' ||
      receipt.signature.signer.signingAlgo !== 'ed25519' ||
      receipt.attestations.length === 0
    ) {
      throw new Error('CFO response was not model-TEE verified');
    }
    const approved = new Set(
      this.environment.NEAR_AI_ALLOWED_DEPLOYMENT_DIGESTS,
    );
    const deploymentDigests = receipt.attestations.map(({ deployment }) =>
      nearAiDeploymentDigest(deployment),
    );
    if (deploymentDigests.some((value) => !approved.has(value))) {
      throw new Error('CFO response used an unapproved deployment');
    }
    let output: unknown;
    try {
      output = JSON.parse(
        completion.data.choices[0]!.message.content,
      ) as unknown;
    } catch {
      throw new Error('NEAR AI message was not JSON');
    }
    return {
      provider: this.provider,
      model: this.model,
      providerRequestId: completion.data.id,
      attestationStatus: 'VERIFIED_PROVIDER_TEE',
      verificationEvidence: {
        verificationMethod: 'nearai-inference-sdk-v0.3',
        signatureKind: 'provider_tee',
        signingAlgo: 'ed25519',
        signingAddress: receipt.signature.signer.signingAddress,
        deploymentDigests,
      },
      output,
    };
  }
}
