import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  type CfoInferenceAdapter,
  type CfoInferenceInput,
  type CfoInferenceResult,
  NEAR_AI_FETCH,
} from './automation.types.js';

type FetchLike = typeof fetch;

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
  private readonly fetcher: FetchLike;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Optional() @Inject(NEAR_AI_FETCH) fetcher?: FetchLike,
  ) {
    this.model = environment.NEAR_AI_MODEL;
    this.fetcher = fetcher ?? fetch;
  }

  async infer(input: CfoInferenceInput): Promise<CfoInferenceResult> {
    if (
      !this.environment.NEAR_AI_CFO_ENABLED ||
      this.environment.AI_CFO_PROVIDER !== 'near-ai' ||
      !this.environment.NEAR_AI_API_KEY
    ) {
      throw new Error('NEAR AI CFO inference is disabled');
    }
    const body = JSON.stringify({
      model: this.model,
      stream: false,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Return one JSON object only. Never request a payment, transfer, URL, tool call, account number, or policy override. Required shape: {"allocations":[{"category":string,"amountAtomic":positive integer string,"reason":string,"supportingRecordIds":string[],"confidenceBps":integer 0..10000,"uncertainty":string}],"summary":string}.',
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
    });
    const base = new URL(this.environment.NEAR_AI_BASE_URL);
    let response: Response;
    try {
      response = await this.fetcher(
        new URL(`${base.toString().replace(/\/$/, '')}/chat/completions`),
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            accept: 'application/json',
            'accept-encoding': 'identity',
            authorization: `Bearer ${this.environment.NEAR_AI_API_KEY}`,
            'content-type': 'application/json',
            'x-no-aliasing': 'true',
          },
          body,
        },
      );
    } catch {
      throw new Error('NEAR AI request failed');
    }
    if (!response.ok) throw new Error(`NEAR AI HTTP ${response.status}`);
    const raw = await boundedText(response);
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('NEAR AI returned malformed JSON');
    }
    const completion = completionSchema.safeParse(value);
    if (!completion.success || completion.data.model !== this.model) {
      throw new Error('NEAR AI completion schema or model mismatch');
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
      providerRequestId:
        response.headers.get('x-request-id') ?? completion.data.id,
      // B-08 does not fetch and cryptographically verify preflight attestation
      // plus the exact-byte response signature. Never label this private/verified.
      attestationStatus: 'UNVERIFIED',
      output,
    };
  }
}

async function boundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 1_000_000) {
    throw new Error('NEAR AI response too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_000_000) {
    throw new Error('NEAR AI response too large');
  }
  return text;
}
