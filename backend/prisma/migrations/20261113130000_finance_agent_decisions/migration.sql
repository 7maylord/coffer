BEGIN;

ALTER TABLE "FinanceAgentRun"
  ADD COLUMN "inferenceStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "inferenceProvider" TEXT,
  ADD COLUMN "inferenceModel" TEXT,
  ADD COLUMN "inputDigest" TEXT,
  ADD COLUMN "responseDigest" TEXT,
  ADD COLUMN "providerRequestId" TEXT,
  ADD COLUMN "attestationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "verificationEvidence" JSONB,
  ADD COLUMN "decision" JSONB,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3);

ALTER TABLE "FinanceAgentRun"
  ADD CONSTRAINT "FinanceAgentRun_inference_result_check" CHECK (
    (
      "inferenceStatus" = 'PENDING' AND
      "decision" IS NULL AND
      "errorCode" IS NULL AND
      "decidedAt" IS NULL
    ) OR (
      "inferenceStatus" = 'VERIFIED' AND
      "attestationStatus" = 'VERIFIED_PROVIDER_TEE' AND
      "inputDigest" ~ '^[0-9a-f]{64}$' AND
      "responseDigest" ~ '^[0-9a-f]{64}$' AND
      "verificationEvidence" IS NOT NULL AND
      "decision" IS NOT NULL AND
      "errorCode" IS NULL AND
      "decidedAt" IS NOT NULL
    ) OR (
      "inferenceStatus" = 'FAILED' AND
      "decision" IS NULL AND
      "errorCode" IS NOT NULL AND
      "decidedAt" IS NOT NULL
    )
  );

CREATE TRIGGER "FinanceAgentRun_audit_state_update"
AFTER UPDATE OF "state" ON "FinanceAgentRun"
FOR EACH ROW WHEN (OLD."state" IS DISTINCT FROM NEW."state")
EXECUTE FUNCTION append_business_audit_event(
  'FINANCE_AGENT_RUN_STATE_CHANGED', 'FINANCE_AGENT_RUN'
);

COMMIT;
