BEGIN;

ALTER TABLE "FinanceAgentRun"
  ADD COLUMN "policyOutcome" TEXT,
  ADD COLUMN "policyInputsDigest" TEXT,
  ADD COLUMN "policyDigest" TEXT,
  ADD COLUMN "policyVersion" INTEGER,
  ADD COLUMN "policyReasonCodes" JSONB,
  ADD COLUMN "instructionDigest" TEXT,
  ADD COLUMN "actionMaterial" JSONB,
  ADD COLUMN "actionAssetId" TEXT,
  ADD COLUMN "actionAmountAtomic" DECIMAL(78,0),
  ADD COLUMN "sourceAccountId" UUID,
  ADD COLUMN "reservationId" UUID,
  ADD COLUMN "policyEvaluatedAt" TIMESTAMP(3),
  ADD COLUMN "actionErrorCode" TEXT;

CREATE UNIQUE INDEX "FinanceAgentRun_instructionDigest_key"
  ON "FinanceAgentRun"("instructionDigest");
CREATE UNIQUE INDEX "FinanceAgentRun_reservationId_key"
  ON "FinanceAgentRun"("reservationId");
CREATE INDEX "FinanceAgentRun_organizationId_actionAssetId_policyEvaluatedAt_idx"
  ON "FinanceAgentRun"("organizationId", "actionAssetId", "policyEvaluatedAt");

ALTER TABLE "FinanceAgentRun"
  ADD CONSTRAINT "FinanceAgentRun_policy_action_check" CHECK (
    (
      "policyOutcome" IS NULL AND
      "policyInputsDigest" IS NULL AND
      "policyReasonCodes" IS NULL AND
      "instructionDigest" IS NULL AND
      "actionMaterial" IS NULL AND
      "actionAssetId" IS NULL AND
      "actionAmountAtomic" IS NULL AND
      "sourceAccountId" IS NULL AND
      "reservationId" IS NULL AND
      "policyEvaluatedAt" IS NULL AND
      "actionErrorCode" IS NULL
    ) OR (
      "policyOutcome" IN ('ALLOW', 'DENY', 'REQUIRES_APPROVAL') AND
      "policyInputsDigest" ~ '^[0-9a-f]{64}$' AND
      "policyReasonCodes" IS NOT NULL AND
      "actionMaterial" IS NOT NULL AND
      "actionAssetId" IS NOT NULL AND
      "actionAmountAtomic" > 0 AND
      "sourceAccountId" IS NOT NULL AND
      "policyEvaluatedAt" IS NOT NULL AND
      (
        ("policyDigest" IS NULL AND "policyVersion" IS NULL AND "instructionDigest" IS NULL) OR
        ("policyDigest" ~ '^[0-9a-f]{64}$' AND "policyVersion" > 0 AND "instructionDigest" ~ '^[0-9a-f]{64}$')
      ) AND
      ("reservationId" IS NULL OR "policyOutcome" = 'ALLOW')
    )
  );

COMMIT;
