import { parseEnvironment } from '../config/env.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import { PayrollEnvelopeEncryption } from './payroll-crypto.js';
import { PayrollService } from './payroll.service.js';
import type {
  PayrollAttestationVerifier,
  PayrollStore,
  PrivatePayrollAnalyzer,
  StoredPayrollBatch,
} from './payroll.types.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const userOne = '33333333-3333-4333-8333-333333333333';
const userTwo = '44444444-4444-4444-8444-444444444444';
const batchId = '55555555-5555-4555-8555-555555555555';
const lineOne = '66666666-6666-4666-8666-666666666666';
const lineTwo = '77777777-7777-4777-8777-777777777777';
const encryptionKey = Buffer.alloc(32, 9).toString('base64');
const csv = [
  'employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic',
  `EMP-001,${userOne},Ada Example,Synthetic One,ada.testnet,1000000`,
  `EMP-002,${userTwo},Lin Example,Synthetic Two,lin.testnet,3000000`,
].join('\n');

function createStore() {
  let batch: StoredPayrollBatch | null = null;
  const api: PayrollStore = {
    batches: vi.fn().mockImplementation(async () => (batch ? [batch] : [])),
    createBatch: vi
      .fn()
      .mockImplementation(
        async (input: Parameters<PayrollStore['createBatch']>[0]) => {
          batch = {
            id: batchId,
            organizationId,
            reference: input.reference,
            status: 'DRAFT',
            assetId: input.assetId,
            manifestDigest: input.manifestDigest,
            totalGrossAtomic: input.totalGrossAtomic,
            totalNetAtomic: input.totalNetAtomic,
            lineCount: input.lines.length,
            perEmployeeCapAtomic: input.perEmployeeCapAtomic,
            batchCapAtomic: input.batchCapAtomic,
            wrappedDataKey: input.wrappedDataKey,
            dataKeyNonce: input.dataKeyNonce,
            encryptionKeyVersion: input.encryptionKeyVersion,
            calculationAssumption: 'SYNTHETIC_NO_TAX',
            approvedManifestDigest: null,
            approvedByUserId: null,
            approvedAt: null,
            version: 1,
            createdAt: new Date('2026-10-30T12:00:00.000Z'),
            lines: input.lines.map((line, index) => ({
              id: index === 0 ? lineOne : lineTwo,
              organizationId,
              batchId,
              employeeId: index === 0 ? userOne : userTwo,
              employeeCode: line.employeeCode,
              userId: line.userId,
              salaryCiphertext: line.salaryCiphertext,
              salaryNonce: line.salaryNonce,
              netCiphertext: line.netCiphertext,
              netNonce: line.netNonce,
              profileCiphertext: line.profileCiphertext,
              profileNonce: line.profileNonce,
              amountCommitment: line.amountCommitment,
              lineDigest: line.lineDigest,
              encryptionKeyVersion: line.encryptionKeyVersion,
            })),
          };
          return batch;
        },
      ),
    batch: vi.fn().mockImplementation(async () => batch),
    approveBatch: vi.fn().mockImplementation(async (input) => {
      if (!batch) return null;
      batch = {
        ...batch,
        status: 'APPROVED',
        approvedManifestDigest: input.expectedManifestDigest,
        approvedByUserId: input.actorUserId,
        approvedAt: input.now,
        version: 2,
      };
      return batch;
    }),
    payslipForUser: vi
      .fn()
      .mockImplementation(async (userId, requestedLineId) => {
        if (!batch) return null;
        const lines = batch.lines.filter(
          (line) => line.userId === userId && line.id === requestedLineId,
        );
        return lines.length === 1 ? { ...batch, lines } : null;
      }),
    payslipsForUser: vi
      .fn()
      .mockImplementation(async () =>
        batch ? [{ ...batch, lines: batch.lines.slice(0, 1) }] : [],
      ),
    auditDeniedPayslipAccess: vi.fn().mockResolvedValue(undefined),
    recordSensitiveRead: vi.fn().mockResolvedValue(undefined),
    recordAnalysis: vi.fn().mockResolvedValue({ id: 'analysis-1' }),
  };
  return api;
}

function fixture(
  options: {
    privateEnabled?: boolean;
    analyzer?: PrivatePayrollAnalyzer;
    verifier?: PayrollAttestationVerifier;
  } = {},
) {
  const environment = parseEnvironment({
    ENCRYPTION_KEY_BASE64: encryptionKey,
    ENCRYPTION_KEY_VERSION: 'test-key-v1',
    ...(options.privateEnabled
      ? {
          FEATURE_PRIVATE_AI: 'true',
          PRIVATE_AI_PROVIDER: 'near-ai',
          NEAR_AI_API_KEY: 'test-api-key',
        }
      : {}),
  });
  const store = createStore();
  const analyzer =
    options.analyzer ??
    ({
      provider: 'fixture-ai',
      model: 'fixture/model',
      analyze: vi.fn().mockRejectedValue(new Error('unavailable')),
    } satisfies PrivatePayrollAnalyzer);
  const verifier = options.verifier ?? {
    verify: vi.fn().mockReturnValue(false),
  };
  const service = new PayrollService(
    store,
    analyzer,
    verifier,
    new PayrollEnvelopeEncryption(environment),
    new AssetRegistry(),
    environment,
  );
  return { service, store, analyzer, verifier };
}

async function imported(test: ReturnType<typeof fixture>) {
  return test.service.importSynthetic(organizationId, actorUserId, {
    reference: 'SYNTHETIC-2026-10',
    assetId: 'mock:base:usdc',
    synthetic: true,
    perEmployeeCapAtomic: '5000000',
    batchCapAtomic: '10000000',
    csv,
  });
}

describe('PayrollService', () => {
  it('lists only summary batches and self-scoped decrypted payslips', async () => {
    const test = fixture();
    await imported(test);
    await expect(test.service.batches(organizationId)).resolves.toMatchObject([
      { id: batchId, lineCount: 2 },
    ]);
    await expect(test.service.payslips(userOne)).resolves.toMatchObject([
      { id: lineOne, legalName: 'Ada Example', grossAmountAtomic: '1000000' },
    ]);
    expect(test.store.recordSensitiveRead).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: userOne,
        entityId: lineOne,
        eventType: 'PAYSLIP_SELF_READ',
      }),
    );
  });

  it('encrypts every sensitive field and produces an exact no-tax manifest', async () => {
    const test = fixture();
    await expect(imported(test)).resolves.toMatchObject({
      totalGrossAtomic: '4000000',
      totalNetAtomic: '4000000',
      calculationAssumption: 'SYNTHETIC_NO_TAX',
      lineCount: 2,
    });
    const stored = vi.mocked(test.store.createBatch).mock.calls[0]![0];
    const bytes = Buffer.concat([
      stored.wrappedDataKey,
      ...stored.lines.flatMap((line) => [
        line.salaryCiphertext,
        line.netCiphertext,
        line.profileCiphertext,
      ]),
    ]).toString('utf8');
    expect(bytes).not.toContain('Ada Example');
    expect(bytes).not.toContain('ada.testnet');
    expect(stored.lines[0]!.lineDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('decrypts finance and self-only views and audits both reads', async () => {
    const test = fixture();
    await imported(test);
    await expect(
      test.service.batch(organizationId, batchId, actorUserId),
    ).resolves.toMatchObject({
      lines: [
        expect.objectContaining({
          grossAmountAtomic: '1000000',
          profile: expect.objectContaining({ legalName: 'Ada Example' }),
        }),
        expect.anything(),
      ],
    });
    await expect(test.service.payslip(userOne, lineOne)).resolves.toMatchObject(
      {
        legalName: 'Ada Example',
        grossAmountAtomic: '1000000',
        netAmountAtomic: '1000000',
      },
    );
    expect(test.store.recordSensitiveRead).toHaveBeenCalledTimes(2);
  });

  it('T-PRV-04/T-PRV-06 hides another employee payslip and audits the denial', async () => {
    const test = fixture();
    await imported(test);
    await expect(test.service.payslip(userTwo, lineOne)).rejects.toMatchObject({
      code: 'PAYROLL_NOT_FOUND',
    });
    expect(test.store.auditDeniedPayslipAccess).toHaveBeenCalledWith(
      userTwo,
      lineOne,
    );
  });

  it('T-PRV-09 binds approval to the exact manifest and version', async () => {
    const test = fixture();
    const batch = await imported(test);
    await expect(
      test.service.approve(
        organizationId,
        batchId,
        actorUserId,
        'f'.repeat(64),
        1,
      ),
    ).rejects.toMatchObject({ code: 'PAYROLL_MANIFEST_MISMATCH' });
    await expect(
      test.service.approve(
        organizationId,
        batchId,
        actorUserId,
        batch.manifestDigest,
        1,
      ),
    ).resolves.toMatchObject({
      status: 'APPROVED',
      approvedManifestDigest: batch.manifestDigest,
    });
  });

  it('runs deterministic fallback without making a TEE claim', async () => {
    const test = fixture();
    await imported(test);
    await expect(
      test.service.analyze(
        organizationId,
        batchId,
        actorUserId,
        'deterministic',
      ),
    ).resolves.toMatchObject({
      attestationStatus: 'NOT_REQUESTED',
      findings: [expect.objectContaining({ lineId: lineTwo })],
    });
  });

  it('T-PRV-08 blocks strict private analysis when disabled or unverified', async () => {
    const disabled = fixture();
    await imported(disabled);
    await expect(
      disabled.service.analyze(
        organizationId,
        batchId,
        actorUserId,
        'private-ai',
      ),
    ).rejects.toMatchObject({ code: 'PRIVATE_AI_DISABLED' });

    const analyzer: PrivatePayrollAnalyzer = {
      provider: 'near-ai-cloud',
      model: 'fixture/model',
      analyze: vi.fn().mockResolvedValue({
        provider: 'near-ai-cloud',
        model: 'fixture/model',
        requestStartedAt: new Date(),
        exactRequestBody: Buffer.from('{}'),
        exactResponseBody: Buffer.from('{}'),
        output: { findings: [], summary: 'fixture' },
      }),
    };
    const unverified = fixture({ privateEnabled: true, analyzer });
    await imported(unverified);
    await expect(
      unverified.service.analyze(
        organizationId,
        batchId,
        actorUserId,
        'private-ai',
      ),
    ).rejects.toMatchObject({ code: 'PRIVATE_AI_UNVERIFIED' });
    expect(unverified.store.recordAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        attestationStatus: 'UNVERIFIED',
        errorCode: 'ATTESTATION_INVALID',
      }),
    );
  });

  it('accepts only schema-bounded findings after strict verification', async () => {
    const analyzer: PrivatePayrollAnalyzer = {
      provider: 'near-ai-cloud',
      model: 'fixture/model',
      analyze: vi.fn().mockResolvedValue({
        provider: 'near-ai-cloud',
        model: 'fixture/model',
        providerRequestId: 'request-1',
        requestStartedAt: new Date(),
        exactRequestBody: Buffer.from('{}'),
        exactResponseBody: Buffer.from('{}'),
        output: {
          findings: [
            {
              lineId: lineOne,
              code: 'REVIEW_RECOMMENDED',
              severity: 'MEDIUM',
              explanation: 'Review synthetic fixture',
            },
          ],
          summary: 'fixture',
        },
      }),
    };
    const test = fixture({
      privateEnabled: true,
      analyzer,
      verifier: { verify: vi.fn().mockReturnValue(true) },
    });
    await imported(test);
    await expect(
      test.service.analyze(organizationId, batchId, actorUserId, 'private-ai'),
    ).resolves.toMatchObject({
      attestationStatus: 'VERIFIED_PROVIDER_TEE',
      findings: [expect.objectContaining({ lineId: lineOne })],
    });
  });

  it('T-PRV-10 keeps sensitive values out of manifest and analysis records', async () => {
    const test = fixture();
    const batch = await imported(test);
    expect(JSON.stringify(batch)).not.toContain('Ada Example');
    expect(JSON.stringify(batch)).not.toContain('ada.testnet');
    await test.service.analyze(
      organizationId,
      batchId,
      actorUserId,
      'deterministic',
    );
    expect(
      JSON.stringify(vi.mocked(test.store.recordAnalysis).mock.calls),
    ).not.toContain('Ada Example');
  });
});
