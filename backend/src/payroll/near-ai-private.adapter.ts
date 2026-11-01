import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  NEAR_AI_MODEL_REPORT_VERIFIER,
  NEAR_AI_PRIVATE_FETCH,
  type NearAiModelReportVerifier,
  type PayrollAnalysisInput,
  type PrivateAnalysisResult,
  type PrivatePayrollAnalyzer,
} from './payroll.types.js';

type FetchLike = typeof fetch;

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
const attestationSchema = z
  .object({
    model_attestations: z.array(z.unknown()).min(1).max(20),
  })
  .passthrough();
const signatureSchema = z
  .object({
    signature_kind: z.string(),
    signing_algo: z.string(),
    signing_address: z.string(),
    text: z.string().max(1000),
    signature: z.string(),
  })
  .passthrough();

@Injectable()
export class UnavailableNearAiModelReportVerifier implements NearAiModelReportVerifier {
  verify(): Promise<[]> {
    return Promise.resolve([]);
  }
}

@Injectable()
export class NearAiPrivatePayrollAnalyzer implements PrivatePayrollAnalyzer {
  readonly provider = 'near-ai-cloud';
  readonly model: string;
  private readonly fetcher: FetchLike;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(NEAR_AI_MODEL_REPORT_VERIFIER)
    private readonly reportVerifier: NearAiModelReportVerifier,
    @Optional() @Inject(NEAR_AI_PRIVATE_FETCH) fetcher?: FetchLike,
  ) {
    this.model = environment.NEAR_AI_MODEL;
    this.fetcher = fetcher ?? fetch;
  }

  async analyze(input: PayrollAnalysisInput): Promise<PrivateAnalysisResult> {
    if (
      !this.environment.FEATURE_PRIVATE_AI ||
      this.environment.PRIVATE_AI_PROVIDER !== 'near-ai' ||
      !this.environment.NEAR_AI_API_KEY
    ) {
      throw new Error('Private AI is disabled');
    }
    const base = this.environment.NEAR_AI_BASE_URL.replace(/\/$/, '');
    const requestNonce = randomBytes(32).toString('hex');
    const attestationUrl = new URL(`${base}/attestation/report`);
    attestationUrl.searchParams.set('model', this.model);
    attestationUrl.searchParams.set('provider', 'near');
    attestationUrl.searchParams.set('include_tls_fingerprint', 'false');
    attestationUrl.searchParams.set('signing_algo', 'ed25519');
    attestationUrl.searchParams.set('nonce', requestNonce);
    const attestationResponse = await this.request(attestationUrl);
    const attestation = attestationSchema.parse(
      JSON.parse(await boundedText(attestationResponse)) as unknown,
    );
    const verifiedModelReports = await this.reportVerifier.verify({
      candidates: attestation.model_attestations,
      requestNonce,
      model: this.model,
    });
    if (
      verifiedModelReports.length !== attestation.model_attestations.length ||
      verifiedModelReports.length === 0
    ) {
      throw new Error('Model attestation preflight was not verified');
    }
    const exactRequestBody = Buffer.from(
      JSON.stringify({
        model: this.model,
        stream: false,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Return one JSON object only with findings and summary. Findings may contain only lineId, code, severity, and explanation. Never return names, addresses, payout accounts, amounts, URLs, tools, transfers, or policy changes.',
          },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
      'utf8',
    );
    const requestStartedAt = new Date();
    const completionResponse = await this.request(
      new URL(`${base}/chat/completions`),
      {
        method: 'POST',
        body: exactRequestBody,
      },
    );
    const exactResponseBody = Buffer.from(
      await boundedText(completionResponse),
      'utf8',
    );
    const completion = completionSchema.parse(
      JSON.parse(exactResponseBody.toString('utf8')) as unknown,
    );
    if (completion.model !== this.model) throw new Error('Model mismatch');
    const signatureUrl = new URL(
      `${base}/signature/${encodeURIComponent(completion.id)}`,
    );
    signatureUrl.searchParams.set('signing_algo', 'ed25519');
    const signature = signatureSchema.parse(
      JSON.parse(
        await boundedText(await this.request(signatureUrl)),
      ) as unknown,
    );
    return {
      provider: this.provider,
      model: this.model,
      providerRequestId:
        completionResponse.headers.get('x-request-id') ?? completion.id,
      requestStartedAt,
      exactRequestBody,
      exactResponseBody,
      output: JSON.parse(completion.choices[0]!.message.content) as unknown,
      evidence: {
        signatureKind:
          signature.signature_kind === 'provider_tee' ||
          signature.signature_kind === 'gateway'
            ? signature.signature_kind
            : 'unknown',
        signingAlgo: signature.signing_algo,
        signingAddress: signature.signing_address,
        text: signature.text,
        signatureHex: signature.signature,
        verifiedModelReports,
      },
    };
  }

  private async request(url: URL, extra: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...extra,
        method: extra.method ?? 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          authorization: `Bearer ${this.environment.NEAR_AI_API_KEY}`,
          'content-type': 'application/json',
          'x-no-aliasing': 'true',
        },
      });
    } catch {
      throw new Error('NEAR AI request failed');
    }
    if (!response.ok) throw new Error(`NEAR AI HTTP ${response.status}`);
    return response;
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
