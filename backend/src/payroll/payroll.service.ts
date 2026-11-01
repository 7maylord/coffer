import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import { parseAtomicAmount } from '../treasury/money.js';
import { parseSyntheticPayrollCsv } from './payroll-csv.js';
import { PayrollEnvelopeEncryption } from './payroll-crypto.js';
import {
  PAYROLL_ATTESTATION_VERIFIER,
  PAYROLL_STORE,
  PRIVATE_PAYROLL_ANALYZER,
  PayrollError,
  type PayrollAnalysisInput,
  type PayrollAttestationVerifier,
  type PayrollFinding,
  type PayrollProfile,
  type PayrollStore,
  type PrivatePayrollAnalyzer,
  type StoredPayrollBatch,
  type StoredPayrollLine,
} from './payroll.types.js';

const reference = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
const positiveAtomic = z.string().regex(/^[1-9][0-9]{0,77}$/);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const privateOutputSchema = z
  .object({
    findings: z
      .array(
        z
          .object({
            lineId: z.string().uuid(),
            code: z.enum([
              'ABOVE_2X_MEDIAN',
              'DUPLICATE_AMOUNT',
              'REVIEW_RECOMMENDED',
            ]),
            severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
            explanation: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(500),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

@Injectable()
export class PayrollService {
  constructor(
    @Inject(PAYROLL_STORE) private readonly store: PayrollStore,
    @Inject(PRIVATE_PAYROLL_ANALYZER)
    private readonly privateAnalyzer: PrivatePayrollAnalyzer,
    @Inject(PAYROLL_ATTESTATION_VERIFIER)
    private readonly attestationVerifier: PayrollAttestationVerifier,
    @Inject(PayrollEnvelopeEncryption)
    private readonly encryption: PayrollEnvelopeEncryption,
    @Inject(AssetRegistry) private readonly assets: AssetRegistry,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async importSynthetic(
    organizationId: string,
    actorUserId: string,
    input: {
      reference: string;
      assetId: string;
      synthetic: true;
      perEmployeeCapAtomic: string;
      batchCapAtomic: string;
      csv: string;
    },
  ) {
    const parsedInput = z
      .object({
        reference,
        assetId: z.string().min(1).max(192),
        synthetic: z.literal(true),
        perEmployeeCapAtomic: positiveAtomic,
        batchCapAtomic: positiveAtomic,
        csv: z.string().min(1).max(256_000),
      })
      .strict()
      .safeParse(input);
    if (!parsedInput.success) throw invalidImport();
    const value = parsedInput.data;
    const batchReference = value.reference;
    this.assets.require(value.assetId);
    const perEmployeeCap = parseAtomicAmount(value.perEmployeeCapAtomic);
    const batchCap = parseAtomicAmount(value.batchCapAtomic);
    if (perEmployeeCap <= 0n || batchCap < perEmployeeCap)
      throw invalidImport();
    const rows = parseSyntheticPayrollCsv(value.csv);
    let total = 0n;
    for (const row of rows) {
      const amount = BigInt(row.grossAmountAtomic);
      if (amount > perEmployeeCap) throw invalidImport();
      total += amount;
      if (total > batchCap) throw invalidImport();
    }
    const key = this.encryption.createDataKey(organizationId, batchReference);
    try {
      const lines = rows.map((row) => {
        const base = `coffer:payroll:v1:${organizationId}:${batchReference}:${row.employeeCode}`;
        const salary = this.encryption.encrypt(
          key.dataKey,
          row.grossAmountAtomic,
          `${base}:gross`,
        );
        const net = this.encryption.encrypt(
          key.dataKey,
          row.grossAmountAtomic,
          `${base}:net`,
        );
        const profile = this.encryption.encrypt(
          key.dataKey,
          JSON.stringify({
            legalName: row.legalName,
            address: row.address,
            payoutAccount: row.payoutAccount,
          } satisfies PayrollProfile),
          `${base}:profile`,
        );
        const lineDigest = this.encryption.commitment(
          key.dataKey,
          JSON.stringify({
            employeeCode: row.employeeCode,
            userId: row.userId,
            grossAmountAtomic: row.grossAmountAtomic,
            profile: {
              legalName: row.legalName,
              address: row.address,
              payoutAccount: row.payoutAccount,
            },
          }),
        );
        return {
          employeeCode: row.employeeCode,
          userId: row.userId,
          salaryCiphertext: salary.ciphertext,
          salaryNonce: salary.nonce,
          netCiphertext: net.ciphertext,
          netNonce: net.nonce,
          profileCiphertext: profile.ciphertext,
          profileNonce: profile.nonce,
          amountCommitment: this.encryption.commitment(
            key.dataKey,
            `amount:${row.grossAmountAtomic}`,
          ),
          lineDigest,
          encryptionKeyVersion: key.encryptionKeyVersion,
        };
      });
      const manifestDigest = digest({
        domain: 'coffer:payroll-manifest:v1',
        organizationId,
        reference: batchReference,
        assetId: value.assetId,
        totalGrossAtomic: total.toString(),
        totalNetAtomic: total.toString(),
        perEmployeeCapAtomic: perEmployeeCap.toString(),
        batchCapAtomic: batchCap.toString(),
        calculationAssumption: 'SYNTHETIC_NO_TAX',
        lines: lines
          .map(({ employeeCode, userId, lineDigest }) => ({
            employeeCode,
            userId,
            lineDigest,
          }))
          .sort((left, right) =>
            left.employeeCode.localeCompare(right.employeeCode),
          ),
      });
      const batch = await this.store.createBatch({
        organizationId,
        actorUserId,
        reference: batchReference,
        assetId: value.assetId,
        manifestDigest,
        totalGrossAtomic: total.toString(),
        totalNetAtomic: total.toString(),
        perEmployeeCapAtomic: perEmployeeCap.toString(),
        batchCapAtomic: batchCap.toString(),
        wrappedDataKey: key.wrappedDataKey,
        dataKeyNonce: key.dataKeyNonce,
        encryptionKeyVersion: key.encryptionKeyVersion,
        lines,
      });
      return summaryView(batch);
    } finally {
      key.dataKey.fill(0);
    }
  }

  async batches(organizationId: string) {
    return (await this.store.batches(organizationId)).map(summaryView);
  }

  async batch(organizationId: string, batchId: string, actorUserId: string) {
    const batch = await this.requireBatch(organizationId, batchId);
    const view = this.decryptBatch(batch);
    await this.store.recordSensitiveRead({
      organizationId,
      actorUserId,
      entityType: 'PAYROLL_BATCH',
      entityId: batchId,
      eventType: 'PAYROLL_BATCH_SENSITIVE_READ',
    });
    return view;
  }

  async auditView(
    organizationId: string,
    batchId: string,
    actorUserId: string,
    purpose: string,
  ) {
    const normalizedPurpose = z.string().trim().min(10).max(300).parse(purpose);
    const batch = await this.requireBatch(organizationId, batchId);
    await this.store.recordSensitiveRead({
      organizationId,
      actorUserId,
      entityType: 'PAYROLL_AUDIT',
      entityId: batchId,
      eventType: 'PAYROLL_AUDIT_VIEW',
      purpose: normalizedPurpose,
    });
    return {
      ...summaryView(batch),
      employees: batch.lines.map(({ id, employeeCode, amountCommitment }) => ({
        lineId: id,
        employeeCode,
        amountCommitment,
      })),
      purpose: normalizedPurpose,
      confidentiality:
        'Individual values remain encrypted and are omitted from auditor view',
    };
  }

  async payslip(userId: string, lineId: string) {
    const batch = await this.store.payslipForUser(userId, lineId);
    if (!batch) {
      await this.store.auditDeniedPayslipAccess(userId, lineId);
      throw new PayrollError('PAYROLL_NOT_FOUND', 'Payslip was not found');
    }
    const [line] = this.decryptLines(batch);
    if (!line)
      throw new PayrollError('PAYROLL_NOT_FOUND', 'Payslip was not found');
    await this.store.recordSensitiveRead({
      organizationId: batch.organizationId,
      actorUserId: userId,
      entityType: 'PAYSLIP',
      entityId: lineId,
      eventType: 'PAYSLIP_SELF_READ',
    });
    return {
      id: line.id,
      batchId: batch.id,
      reference: batch.reference,
      status: batch.status,
      assetId: batch.assetId,
      employeeCode: line.employeeCode,
      legalName: line.profile.legalName,
      address: line.profile.address,
      payoutAccount: line.profile.payoutAccount,
      grossAmountAtomic: line.grossAmountAtomic,
      netAmountAtomic: line.netAmountAtomic,
      calculationAssumption: batch.calculationAssumption,
      confidentiality:
        'Application-layer encrypted synthetic payroll; payout-chain privacy is not implied',
    };
  }

  async payslips(userId: string) {
    const batches = await this.store.payslipsForUser(userId);
    return Promise.all(
      batches.map(async (batch) => {
        const [line] = this.decryptLines(batch);
        if (!line)
          throw new PayrollError('PAYROLL_NOT_FOUND', 'Payslip was not found');
        await this.store.recordSensitiveRead({
          organizationId: batch.organizationId,
          actorUserId: userId,
          entityType: 'PAYSLIP',
          entityId: line.id,
          eventType: 'PAYSLIP_SELF_READ',
        });
        return {
          id: line.id,
          batchId: batch.id,
          reference: batch.reference,
          status: batch.status,
          assetId: batch.assetId,
          employeeCode: line.employeeCode,
          legalName: line.profile.legalName,
          address: line.profile.address,
          payoutAccount: line.profile.payoutAccount,
          grossAmountAtomic: line.grossAmountAtomic,
          netAmountAtomic: line.netAmountAtomic,
          calculationAssumption: batch.calculationAssumption,
          confidentiality:
            'Application-layer encrypted synthetic payroll; payout-chain privacy is not implied',
        };
      }),
    );
  }

  async approve(
    organizationId: string,
    batchId: string,
    actorUserId: string,
    expectedManifestDigest: string,
    expectedVersion: number,
    now = new Date(),
  ) {
    digestSchema.parse(expectedManifestDigest);
    const existing = await this.requireBatch(organizationId, batchId);
    if (existing.status === 'APPROVED') {
      if (existing.approvedManifestDigest === expectedManifestDigest) {
        return summaryView(existing);
      }
      throw new PayrollError(
        'PAYROLL_MANIFEST_MISMATCH',
        'Approval is bound to another payroll manifest',
      );
    }
    if (existing.manifestDigest !== expectedManifestDigest) {
      throw new PayrollError(
        'PAYROLL_MANIFEST_MISMATCH',
        'Payroll manifest changed before approval',
      );
    }
    const approved = await this.store.approveBatch({
      organizationId,
      batchId,
      actorUserId,
      expectedManifestDigest,
      expectedVersion,
      now,
    });
    if (!approved) {
      throw new PayrollError(
        'PAYROLL_NOT_APPROVABLE',
        'Payroll batch version is no longer approvable',
      );
    }
    return summaryView(approved);
  }

  async analyze(
    organizationId: string,
    batchId: string,
    actorUserId: string,
    mode: 'deterministic' | 'private-ai',
  ) {
    const batch = await this.requireBatch(organizationId, batchId);
    const lines = this.decryptLines(batch);
    const analysisInput: PayrollAnalysisInput = {
      batchId,
      assetId: batch.assetId,
      lines: lines.map(({ id, grossAmountAtomic }) => ({
        lineId: id,
        grossAmountAtomic,
      })),
    };
    const inputDigest = digest(analysisInput);
    if (mode === 'deterministic') {
      const findings = deterministicFindings(analysisInput);
      const run = await this.store.recordAnalysis({
        organizationId,
        batchId,
        actorUserId,
        mode,
        provider: 'coffer-local-rules',
        model: 'payroll-anomaly-v1',
        inputDigest,
        attestationStatus: 'NOT_REQUESTED',
        status: 'VALIDATED',
        findings,
      });
      return {
        id: run.id,
        mode,
        findings,
        attestationStatus: 'NOT_REQUESTED',
        confidentiality:
          'Deterministic local analysis; no private AI or TEE claim',
      };
    }
    if (!this.environment.FEATURE_PRIVATE_AI) {
      throw new PayrollError(
        'PRIVATE_AI_DISABLED',
        'Verified private AI is disabled',
      );
    }
    let result: Awaited<ReturnType<PrivatePayrollAnalyzer['analyze']>>;
    try {
      result = await this.privateAnalyzer.analyze(analysisInput);
    } catch {
      await this.store.recordAnalysis({
        organizationId,
        batchId,
        actorUserId,
        mode,
        provider: this.privateAnalyzer.provider,
        model: this.privateAnalyzer.model,
        inputDigest,
        attestationStatus: 'UNAVAILABLE',
        status: 'FAILED',
        errorCode: 'PROVIDER_UNAVAILABLE',
      });
      throw new PayrollError(
        'PRIVATE_AI_UNAVAILABLE',
        'Verified private analysis is unavailable',
      );
    }
    const responseDigest = hashBuffer(result.exactResponseBody);
    if (!this.attestationVerifier.verify(result)) {
      await this.store.recordAnalysis({
        organizationId,
        batchId,
        actorUserId,
        mode,
        provider: result.provider,
        model: result.model,
        inputDigest,
        responseDigest,
        providerRequestId: result.providerRequestId,
        attestationStatus: 'UNVERIFIED',
        status: 'INVALID',
        errorCode: 'ATTESTATION_INVALID',
      });
      throw new PayrollError(
        'PRIVATE_AI_UNVERIFIED',
        'Private AI response did not pass strict attestation verification',
      );
    }
    const parsed = privateOutputSchema.safeParse(result.output);
    const lineIds = new Set(analysisInput.lines.map(({ lineId }) => lineId));
    if (
      !parsed.success ||
      new Set(
        parsed.success ? parsed.data.findings.map(({ lineId }) => lineId) : [],
      ).size !== (parsed.success ? parsed.data.findings.length : 0) ||
      (parsed.success &&
        parsed.data.findings.some(({ lineId }) => !lineIds.has(lineId)))
    ) {
      await this.store.recordAnalysis({
        organizationId,
        batchId,
        actorUserId,
        mode,
        provider: result.provider,
        model: result.model,
        inputDigest,
        responseDigest,
        providerRequestId: result.providerRequestId,
        attestationStatus: 'VERIFIED_PROVIDER_TEE',
        status: 'INVALID',
        errorCode: 'RESPONSE_SCHEMA_INVALID',
      });
      throw new PayrollError(
        'PRIVATE_AI_RESPONSE_INVALID',
        'Private AI response failed the strict finding schema',
      );
    }
    const run = await this.store.recordAnalysis({
      organizationId,
      batchId,
      actorUserId,
      mode,
      provider: result.provider,
      model: result.model,
      inputDigest,
      responseDigest,
      providerRequestId: result.providerRequestId,
      attestationStatus: 'VERIFIED_PROVIDER_TEE',
      status: 'VALIDATED',
      findings: parsed.data.findings,
    });
    return {
      id: run.id,
      mode,
      findings: parsed.data.findings,
      attestationStatus: 'VERIFIED_PROVIDER_TEE',
      confidentiality:
        'Provider-TEE response signature matched one preflight-verified model report',
    };
  }

  private async requireBatch(organizationId: string, batchId: string) {
    const batch = await this.store.batch(organizationId, batchId);
    if (!batch)
      throw new PayrollError(
        'PAYROLL_NOT_FOUND',
        'Payroll batch was not found',
      );
    return batch;
  }

  private decryptBatch(batch: StoredPayrollBatch) {
    return { ...summaryView(batch), lines: this.decryptLines(batch) };
  }

  private decryptLines(batch: StoredPayrollBatch) {
    const dataKey = this.encryption.unwrapDataKey({
      organizationId: batch.organizationId,
      reference: batch.reference,
      wrappedDataKey: batch.wrappedDataKey,
      dataKeyNonce: batch.dataKeyNonce,
      encryptionKeyVersion: batch.encryptionKeyVersion,
    });
    try {
      return batch.lines.map((line) =>
        decryptLine(this.encryption, dataKey, batch, line),
      );
    } finally {
      dataKey.fill(0);
    }
  }
}

function decryptLine(
  encryption: PayrollEnvelopeEncryption,
  dataKey: Buffer,
  batch: StoredPayrollBatch,
  line: StoredPayrollLine,
) {
  const base = `coffer:payroll:v1:${batch.organizationId}:${batch.reference}:${line.employeeCode}`;
  const profile = JSON.parse(
    encryption.decrypt(
      dataKey,
      { ciphertext: line.profileCiphertext, nonce: line.profileNonce },
      `${base}:profile`,
    ),
  ) as PayrollProfile;
  return {
    id: line.id,
    employeeCode: line.employeeCode,
    userId: line.userId,
    grossAmountAtomic: encryption.decrypt(
      dataKey,
      { ciphertext: line.salaryCiphertext, nonce: line.salaryNonce },
      `${base}:gross`,
    ),
    netAmountAtomic: encryption.decrypt(
      dataKey,
      { ciphertext: line.netCiphertext, nonce: line.netNonce },
      `${base}:net`,
    ),
    profile,
  };
}

function deterministicFindings(input: PayrollAnalysisInput): PayrollFinding[] {
  const amounts = input.lines.map(({ grossAmountAtomic }) =>
    BigInt(grossAmountAtomic),
  );
  const sorted = [...amounts].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0n;
  const counts = new Map<string, number>();
  for (const amount of amounts)
    counts.set(amount.toString(), (counts.get(amount.toString()) ?? 0) + 1);
  return input.lines.reduce<PayrollFinding[]>(
    (findings, { lineId, grossAmountAtomic }) => {
      const amount = BigInt(grossAmountAtomic);
      if (median > 0n && amount > median * 2n) {
        findings.push({
          lineId,
          code: 'ABOVE_2X_MEDIAN',
          severity: 'HIGH',
          explanation: 'Gross amount is more than twice the batch median',
        });
      } else if ((counts.get(grossAmountAtomic) ?? 0) > 1) {
        findings.push({
          lineId,
          code: 'DUPLICATE_AMOUNT',
          severity: 'LOW',
          explanation: 'Gross amount is duplicated within this synthetic batch',
        });
      }
      return findings;
    },
    [],
  );
}

function summaryView(batch: StoredPayrollBatch) {
  return {
    id: batch.id,
    organizationId: batch.organizationId,
    reference: batch.reference,
    status: batch.status,
    assetId: batch.assetId,
    manifestDigest: batch.manifestDigest,
    totalGrossAtomic: batch.totalGrossAtomic,
    totalNetAtomic: batch.totalNetAtomic,
    lineCount: batch.lineCount,
    calculationAssumption: batch.calculationAssumption,
    approvedManifestDigest: batch.approvedManifestDigest,
    approvedAt: batch.approvedAt,
    version: batch.version,
    confidentiality:
      'Synthetic payroll with application-layer envelope encryption; no legal tax calculation',
  };
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex');
}

function hashBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function invalidImport() {
  return new PayrollError(
    'PAYROLL_INVALID_IMPORT',
    'Payroll amounts exceed the explicit synthetic import caps',
  );
}
