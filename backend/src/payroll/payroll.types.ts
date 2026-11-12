export const PAYROLL_STORE = Symbol('PAYROLL_STORE');
export const PRIVATE_PAYROLL_ANALYZER = Symbol('PRIVATE_PAYROLL_ANALYZER');
export const PAYROLL_ATTESTATION_VERIFIER = Symbol(
  'PAYROLL_ATTESTATION_VERIFIER',
);

export const payrollErrorCodes = [
  'PAYROLL_INVALID_IMPORT',
  'PAYROLL_DUPLICATE',
  'PAYROLL_NOT_FOUND',
  'PAYROLL_ACCESS_DENIED',
  'PAYROLL_MANIFEST_MISMATCH',
  'PAYROLL_NOT_APPROVABLE',
  'PAYROLL_PAYOUT_DISABLED',
  'PAYROLL_PAYOUT_NOT_READY',
  'PAYROLL_PAYOUT_CONFLICT',
  'PAYROLL_PAYOUT_NOT_FOUND',
  'PAYROLL_ENCRYPTION_UNAVAILABLE',
  'PRIVATE_AI_DISABLED',
  'PRIVATE_AI_UNAVAILABLE',
  'PRIVATE_AI_UNVERIFIED',
  'PRIVATE_AI_RESPONSE_INVALID',
] as const;

export type PayrollErrorCode = (typeof payrollErrorCodes)[number];

export class PayrollError extends Error {
  constructor(
    readonly code: PayrollErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PayrollError';
  }
}

export type PayrollProfile = {
  legalName: string;
  address: string;
  payoutAccount: string;
};

export type ParsedPayrollRow = PayrollProfile & {
  employeeCode: string;
  userId: string;
  grossAmountAtomic: string;
};

export type EncryptedPayrollLineInput = {
  employeeCode: string;
  userId: string;
  salaryCiphertext: Buffer;
  salaryNonce: Buffer;
  netCiphertext: Buffer;
  netNonce: Buffer;
  profileCiphertext: Buffer;
  profileNonce: Buffer;
  amountCommitment: string;
  lineDigest: string;
  encryptionKeyVersion: string;
};

export type StoredPayrollLine = {
  id: string;
  organizationId: string;
  batchId: string;
  employeeId: string;
  employeeCode: string;
  userId: string | null;
  salaryCiphertext: Buffer;
  salaryNonce: Buffer;
  netCiphertext: Buffer;
  netNonce: Buffer;
  profileCiphertext: Buffer;
  profileNonce: Buffer;
  amountCommitment: string;
  lineDigest: string;
  encryptionKeyVersion: string;
};

export type StoredPayrollBatch = {
  id: string;
  organizationId: string;
  reference: string;
  status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PROCESSING' | 'SETTLED' | 'FAILED';
  assetId: string;
  manifestDigest: string;
  totalGrossAtomic: string;
  totalNetAtomic: string;
  lineCount: number;
  perEmployeeCapAtomic: string;
  batchCapAtomic: string;
  wrappedDataKey: Buffer;
  dataKeyNonce: Buffer;
  encryptionKeyVersion: string;
  calculationAssumption: 'SYNTHETIC_NO_TAX';
  approvedManifestDigest: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  version: number;
  createdAt: Date;
  lines: StoredPayrollLine[];
};

export type StoredPayrollPayoutItem = {
  id: string;
  organizationId: string;
  payoutRunId: string;
  payrollLineId: string;
  status: 'PREPARED' | 'VERIFIED';
  instructionDigest: string;
  transactionHash: string | null;
  evidenceDigest: string | null;
  verifiedAt: Date | null;
};

export type StoredPayrollPayoutRun = {
  id: string;
  organizationId: string;
  batchId: string;
  status: 'PREPARED' | 'PROCESSING' | 'SETTLED';
  signerAccountId: string;
  idempotencyKey: string;
  requestDigest: string;
  approvedManifestDigest: string;
  approvedBatchVersion: number;
  settledAt: Date | null;
  items: StoredPayrollPayoutItem[];
};

export type PayrollFinding = {
  lineId: string;
  code: 'ABOVE_2X_MEDIAN' | 'DUPLICATE_AMOUNT' | 'REVIEW_RECOMMENDED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  explanation: string;
};

export type PayrollAnalysisInput = {
  batchId: string;
  assetId: string;
  lines: Array<{ lineId: string; grossAmountAtomic: string }>;
};

export type PrivateAnalysisEvidence = {
  verificationMethod: 'nearai-inference-sdk-v0.3';
  signatureKind: 'provider_tee';
  signingAlgo: 'ed25519';
  signingAddress: string;
  modelVerifiedAt: string;
  modelAttestationCount: number;
  deploymentDigests: string[];
};

export type PrivateAnalysisResult = {
  provider: string;
  model: string;
  providerRequestId?: string;
  requestStartedAt: Date;
  requestBody: Buffer;
  responseBody: Buffer;
  output: unknown;
  evidence?: PrivateAnalysisEvidence;
};

export interface PrivatePayrollAnalyzer {
  readonly provider: string;
  readonly model: string;
  analyze(input: PayrollAnalysisInput): Promise<PrivateAnalysisResult>;
}

export interface PayrollAttestationVerifier {
  verify(result: PrivateAnalysisResult): boolean;
}

export interface PayrollStore {
  batches(organizationId: string): Promise<StoredPayrollBatch[]>;
  createBatch(input: {
    organizationId: string;
    actorUserId: string;
    reference: string;
    assetId: string;
    manifestDigest: string;
    totalGrossAtomic: string;
    totalNetAtomic: string;
    perEmployeeCapAtomic: string;
    batchCapAtomic: string;
    wrappedDataKey: Buffer;
    dataKeyNonce: Buffer;
    encryptionKeyVersion: string;
    lines: EncryptedPayrollLineInput[];
  }): Promise<StoredPayrollBatch>;
  batch(
    organizationId: string,
    batchId: string,
  ): Promise<StoredPayrollBatch | null>;
  approveBatch(input: {
    organizationId: string;
    batchId: string;
    actorUserId: string;
    expectedManifestDigest: string;
    expectedVersion: number;
    now: Date;
  }): Promise<StoredPayrollBatch | null>;
  payoutRun(
    organizationId: string,
    batchId: string,
  ): Promise<StoredPayrollPayoutRun | null>;
  createPayoutRun(input: {
    organizationId: string;
    batchId: string;
    actorUserId: string;
    signerAccountId: string;
    idempotencyKey: string;
    requestDigest: string;
    approvedManifestDigest: string;
    approvedBatchVersion: number;
    items: Array<{ payrollLineId: string; instructionDigest: string }>;
  }): Promise<StoredPayrollPayoutRun>;
  verifyPayoutItem(input: {
    organizationId: string;
    payoutRunId: string;
    payoutItemId: string;
    actorUserId: string;
    transactionHash: string;
    evidenceDigest: string;
    verifiedAt: Date;
  }): Promise<StoredPayrollPayoutRun | null>;
  payslipForUser(
    userId: string,
    lineId: string,
  ): Promise<StoredPayrollBatch | null>;
  payslipsForUser(userId: string): Promise<StoredPayrollBatch[]>;
  auditDeniedPayslipAccess(userId: string, lineId: string): Promise<void>;
  recordSensitiveRead(input: {
    organizationId: string;
    actorUserId: string;
    entityType: 'PAYROLL_BATCH' | 'PAYSLIP' | 'PAYROLL_AUDIT';
    entityId: string;
    eventType: string;
    purpose?: string;
  }): Promise<void>;
  recordAnalysis(input: {
    organizationId: string;
    batchId: string;
    actorUserId: string;
    mode: 'deterministic' | 'private-ai';
    provider: string;
    model: string;
    inputDigest: string;
    responseDigest?: string;
    attestationStatus: string;
    status: 'VALIDATED' | 'INVALID' | 'FAILED';
    findings?: PayrollFinding[];
    errorCode?: string;
    providerRequestId?: string;
  }): Promise<{ id: string }>;
  onModuleDestroy?(): Promise<void>;
}
