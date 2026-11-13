BEGIN;

ALTER TABLE "FinanceAgentRun"
  ADD COLUMN "procurementAgentId" UUID,
  ADD COLUMN "procurementOfferId" UUID,
  ADD COLUMN "procurementPurchaseId" UUID,
  ADD COLUMN "procurementRequestedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "FinanceAgentRun_procurementOfferId_organizationId_key"
  ON "FinanceAgentRun"("procurementOfferId", "organizationId");
CREATE UNIQUE INDEX "FinanceAgentRun_procurementPurchaseId_organizationId_key"
  ON "FinanceAgentRun"("procurementPurchaseId", "organizationId");

ALTER TABLE "FinanceAgentRun"
  ADD CONSTRAINT "FinanceAgentRun_procurementAgentId_organizationId_fkey"
    FOREIGN KEY ("procurementAgentId", "organizationId") REFERENCES "AgentIdentity"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAgentRun_procurementOfferId_organizationId_fkey"
    FOREIGN KEY ("procurementOfferId", "organizationId") REFERENCES "ServiceOffer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAgentRun_procurementPurchaseId_organizationId_fkey"
    FOREIGN KEY ("procurementPurchaseId", "organizationId") REFERENCES "AgentPurchase"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAgentRun_procurement_shape_check" CHECK (
    ("procurementAgentId" IS NULL AND "procurementOfferId" IS NULL AND "procurementPurchaseId" IS NULL AND "procurementRequestedAt" IS NULL) OR
    ("procurementAgentId" IS NOT NULL AND "procurementOfferId" IS NOT NULL AND "procurementPurchaseId" IS NULL AND "procurementRequestedAt" IS NULL) OR
    ("procurementAgentId" IS NOT NULL AND "procurementOfferId" IS NOT NULL AND "procurementPurchaseId" IS NOT NULL AND "procurementRequestedAt" IS NOT NULL)
  );

COMMIT;
