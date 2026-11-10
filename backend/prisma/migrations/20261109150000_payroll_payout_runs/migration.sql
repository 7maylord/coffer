BEGIN;

CREATE TYPE "PayrollPayoutRunStatus" AS ENUM ('PREPARED', 'PROCESSING', 'SETTLED');
CREATE TYPE "PayrollPayoutItemStatus" AS ENUM ('PREPARED', 'VERIFIED');

CREATE TABLE "PayrollPayoutRun" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "status" "PayrollPayoutRunStatus" NOT NULL DEFAULT 'PREPARED',
  "signerAccountId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "approvedManifestDigest" TEXT NOT NULL,
  "approvedBatchVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "PayrollPayoutRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPayoutRun_digest_check" CHECK (
    "requestDigest" ~ '^[0-9a-f]{64}$' AND
    "approvedManifestDigest" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "PayrollPayoutRun_settlement_check" CHECK (
    ("status" = 'SETTLED' AND "settledAt" IS NOT NULL) OR
    ("status" <> 'SETTLED' AND "settledAt" IS NULL)
  )
);

CREATE TABLE "PayrollPayoutItem" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "payoutRunId" UUID NOT NULL,
  "payrollLineId" UUID NOT NULL,
  "status" "PayrollPayoutItemStatus" NOT NULL DEFAULT 'PREPARED',
  "instructionDigest" TEXT NOT NULL,
  "transactionHash" TEXT,
  "evidenceDigest" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollPayoutItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPayoutItem_digest_check" CHECK (
    "instructionDigest" ~ '^[0-9a-f]{64}$' AND
    ("evidenceDigest" IS NULL OR "evidenceDigest" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "PayrollPayoutItem_verification_check" CHECK (
    ("status" = 'VERIFIED' AND "transactionHash" IS NOT NULL AND "evidenceDigest" IS NOT NULL AND "verifiedAt" IS NOT NULL) OR
    ("status" = 'PREPARED' AND "transactionHash" IS NULL AND "evidenceDigest" IS NULL AND "verifiedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "PayrollPayoutRun_id_organizationId_key" ON "PayrollPayoutRun"("id", "organizationId");
CREATE UNIQUE INDEX "PayrollPayoutRun_organizationId_batchId_key" ON "PayrollPayoutRun"("organizationId", "batchId");
CREATE UNIQUE INDEX "PayrollPayoutRun_organizationId_idempotencyKey_key" ON "PayrollPayoutRun"("organizationId", "idempotencyKey");
CREATE INDEX "PayrollPayoutRun_organizationId_status_createdAt_idx" ON "PayrollPayoutRun"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "PayrollPayoutItem_id_organizationId_key" ON "PayrollPayoutItem"("id", "organizationId");
CREATE UNIQUE INDEX "PayrollPayoutItem_payoutRunId_payrollLineId_key" ON "PayrollPayoutItem"("payoutRunId", "payrollLineId");
CREATE UNIQUE INDEX "PayrollPayoutItem_transactionHash_key" ON "PayrollPayoutItem"("transactionHash");
CREATE INDEX "PayrollPayoutItem_organizationId_status_createdAt_idx" ON "PayrollPayoutItem"("organizationId", "status", "createdAt");

ALTER TABLE "PayrollPayoutRun"
  ADD CONSTRAINT "PayrollPayoutRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollPayoutRun_batchId_organizationId_fkey" FOREIGN KEY ("batchId", "organizationId") REFERENCES "PayrollBatch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollPayoutRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollPayoutItem"
  ADD CONSTRAINT "PayrollPayoutItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollPayoutItem_payoutRunId_organizationId_fkey" FOREIGN KEY ("payoutRunId", "organizationId") REFERENCES "PayrollPayoutRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollPayoutItem_payrollLineId_organizationId_fkey" FOREIGN KEY ("payrollLineId", "organizationId") REFERENCES "PayrollLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION guard_private_payroll_batch_update()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."organizationId", NEW."reference", NEW."currency", NEW."isSynthetic",
    NEW."schemaVersion", NEW."manifestDigest", NEW."totalGrossAtomic",
    NEW."totalNetAtomic", NEW."lineCount", NEW."perEmployeeCapAtomic",
    NEW."batchCapAtomic", NEW."wrappedDataKey", NEW."dataKeyNonce",
    NEW."encryptionKeyVersion", NEW."calculationAssumption", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."reference", OLD."currency", OLD."isSynthetic",
    OLD."schemaVersion", OLD."manifestDigest", OLD."totalGrossAtomic",
    OLD."totalNetAtomic", OLD."lineCount", OLD."perEmployeeCapAtomic",
    OLD."batchCapAtomic", OLD."wrappedDataKey", OLD."dataKeyNonce",
    OLD."encryptionKeyVersion", OLD."calculationAssumption", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'PayrollBatch manifest fields cannot change' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('REVIEW', 'APPROVED')) OR
    (OLD."status" = 'REVIEW' AND NEW."status" IN ('APPROVED', 'FAILED')) OR
    (OLD."status" = 'APPROVED' AND NEW."status" = 'PROCESSING') OR
    (OLD."status" = 'PROCESSING' AND NEW."status" IN ('SETTLED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'PayrollBatch status transition is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
