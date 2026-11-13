BEGIN;

CREATE TABLE "FinanceAgentRun" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "settlementPostingId" UUID NOT NULL,
  "triggerType" TEXT NOT NULL DEFAULT 'INVOICE_SETTLED',
  "objective" TEXT NOT NULL DEFAULT 'ALLOCATE_VERIFIED_INVOICE_REVENUE',
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "sourceEvidenceIds" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceAgentRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceAgentRun_shape_check" CHECK (
    "triggerType" = 'INVOICE_SETTLED' AND
    "objective" = 'ALLOCATE_VERIFIED_INVOICE_REVENUE' AND
    length("state") > 0 AND
    "version" > 0
  )
);

CREATE UNIQUE INDEX "PaymentAttempt_id_organizationId_key"
  ON "PaymentAttempt"("id", "organizationId");
CREATE UNIQUE INDEX "SettlementPosting_id_organizationId_key"
  ON "SettlementPosting"("id", "organizationId");
CREATE UNIQUE INDEX "FinanceAgentRun_settlementPostingId_key"
  ON "FinanceAgentRun"("settlementPostingId");
CREATE UNIQUE INDEX "FinanceAgentRun_settlementPostingId_organizationId_key"
  ON "FinanceAgentRun"("settlementPostingId", "organizationId");
CREATE INDEX "FinanceAgentRun_organizationId_state_createdAt_idx"
  ON "FinanceAgentRun"("organizationId", "state", "createdAt");

ALTER TABLE "FinanceAgentRun"
  ADD CONSTRAINT "FinanceAgentRun_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAgentRun_invoiceId_organizationId_fkey"
    FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "Invoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAgentRun_paymentAttemptId_organizationId_fkey"
    FOREIGN KEY ("paymentAttemptId", "organizationId") REFERENCES "PaymentAttempt"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAgentRun_settlementPostingId_organizationId_fkey"
    FOREIGN KEY ("settlementPostingId", "organizationId") REFERENCES "SettlementPosting"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "FinanceAgentRun_audit_insert"
AFTER INSERT ON "FinanceAgentRun"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'FINANCE_AGENT_RUN_CREATED', 'FINANCE_AGENT_RUN'
);

COMMIT;
