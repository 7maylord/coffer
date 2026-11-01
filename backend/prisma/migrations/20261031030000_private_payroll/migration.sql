BEGIN;

ALTER TABLE "EmployeeProfile"
  ADD CONSTRAINT "EmployeeProfile_id_organizationId_key" UNIQUE ("id", "organizationId");

UPDATE "EmployeeProfile" SET "displayName" = "employeeCode";

ALTER TABLE "PayrollBatch"
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "manifestDigest" TEXT NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN "totalGrossAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN "totalNetAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN "lineCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "perEmployeeCapAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN "batchCapAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN "wrappedDataKey" BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN "dataKeyNonce" BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'legacy-unavailable',
  ADD COLUMN "calculationAssumption" TEXT NOT NULL DEFAULT 'SYNTHETIC_NO_TAX',
  ADD COLUMN "approvedManifestDigest" TEXT,
  ADD COLUMN "approvedByUserId" UUID,
  ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "PayrollBatch" ALTER COLUMN "schemaVersion" SET DEFAULT 1;
ALTER TABLE "PayrollBatch"
  ADD CONSTRAINT "PayrollBatch_id_organizationId_key" UNIQUE ("id", "organizationId"),
  ADD CONSTRAINT "PayrollBatch_manifest_digest_check"
    CHECK ("manifestDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "PayrollBatch_approval_consistency_check"
    CHECK (
      ("approvedManifestDigest" IS NULL AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL)
      OR
      ("approvedManifestDigest" = "manifestDigest" AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "PayrollBatch_private_schema_check"
    CHECK (
      "schemaVersion" = 0 OR (
        "schemaVersion" = 1
        AND "isSynthetic" = true
        AND "lineCount" BETWEEN 1 AND 500
        AND "totalGrossAtomic" >= 0
        AND "totalNetAtomic" = "totalGrossAtomic"
        AND "perEmployeeCapAtomic" > 0
        AND "batchCapAtomic" >= "perEmployeeCapAtomic"
        AND "totalGrossAtomic" <= "batchCapAtomic"
        AND octet_length("wrappedDataKey") = 48
        AND octet_length("dataKeyNonce") = 12
        AND length("encryptionKeyVersion") BETWEEN 1 AND 100
        AND "calculationAssumption" = 'SYNTHETIC_NO_TAX'
      )
    );

CREATE INDEX "PayrollBatch_organizationId_status_createdAt_idx"
  ON "PayrollBatch"("organizationId", "status", "createdAt");

ALTER TABLE "PayrollBatch"
  ADD CONSTRAINT "PayrollBatch_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollLine" ADD COLUMN "organizationId" UUID;
UPDATE "PayrollLine" line
SET "organizationId" = batch."organizationId"
FROM "PayrollBatch" batch
WHERE batch."id" = line."batchId";
ALTER TABLE "PayrollLine" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "PayrollLine"
  ADD COLUMN "netCiphertext" BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN "netNonce" BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN "profileCiphertext" BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN "profileNonce" BYTEA NOT NULL DEFAULT ''::bytea,
  ADD COLUMN "amountCommitment" TEXT NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN "lineDigest" TEXT NOT NULL DEFAULT repeat('0', 64),
  ADD CONSTRAINT "PayrollLine_amount_commitment_check"
    CHECK ("amountCommitment" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "PayrollLine_digest_check"
    CHECK ("lineDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "PayrollLine_id_organizationId_key" UNIQUE ("id", "organizationId");

CREATE INDEX "PayrollLine_organizationId_employeeId_createdAt_idx"
  ON "PayrollLine"("organizationId", "employeeId", "createdAt");

ALTER TABLE "PayrollLine" DROP CONSTRAINT "PayrollLine_batchId_fkey";
ALTER TABLE "PayrollLine" DROP CONSTRAINT "PayrollLine_employeeId_fkey";
ALTER TABLE "PayrollLine"
  ADD CONSTRAINT "PayrollLine_batchId_organizationId_fkey"
  FOREIGN KEY ("batchId", "organizationId")
  REFERENCES "PayrollBatch"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLine"
  ADD CONSTRAINT "PayrollLine_employeeId_organizationId_fkey"
  FOREIGN KEY ("employeeId", "organizationId")
  REFERENCES "EmployeeProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayrollAnalysisRun" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "mode" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "responseDigest" TEXT,
  "attestationStatus" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "findings" JSONB,
  "errorCode" TEXT,
  "providerRequestId" TEXT,
  "promptTemplateVersion" TEXT NOT NULL,
  "inputClassification" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollAnalysisRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollAnalysisRun_input_digest_check" CHECK ("inputDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PayrollAnalysisRun_response_digest_check" CHECK ("responseDigest" IS NULL OR "responseDigest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "PayrollAnalysisRun_organizationId_batchId_createdAt_idx"
  ON "PayrollAnalysisRun"("organizationId", "batchId", "createdAt");

ALTER TABLE "PayrollAnalysisRun"
  ADD CONSTRAINT "PayrollAnalysisRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollAnalysisRun_batchId_organizationId_fkey"
  FOREIGN KEY ("batchId", "organizationId")
  REFERENCES "PayrollBatch"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollAnalysisRun_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_private_payroll_batch_update()
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
    RAISE EXCEPTION 'PayrollBatch manifest fields cannot change'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" <> 'APPROVED' THEN
    RAISE EXCEPTION 'Approved payroll batch status cannot regress'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollBatch_guard_update"
BEFORE UPDATE ON "PayrollBatch"
FOR EACH ROW EXECUTE FUNCTION guard_private_payroll_batch_update();

CREATE FUNCTION reject_private_payroll_row_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollLine_append_only"
BEFORE UPDATE ON "PayrollLine"
FOR EACH ROW EXECUTE FUNCTION reject_private_payroll_row_update();

CREATE TRIGGER "PayrollAnalysisRun_append_only"
BEFORE UPDATE ON "PayrollAnalysisRun"
FOR EACH ROW EXECUTE FUNCTION reject_private_payroll_row_update();

COMMIT;
