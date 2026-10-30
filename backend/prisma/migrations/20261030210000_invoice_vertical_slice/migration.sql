BEGIN;

ALTER TABLE "Invoice"
  ADD COLUMN "customer" JSONB,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "dueDate" TIMESTAMP(3),
  ADD COLUMN "verifiedReceivedAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "expiredAt" TIMESTAMP(3),
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3);

UPDATE "Invoice"
SET "customer" = '{"displayName":"Synthetic customer"}'::jsonb,
    "metadata" = '{}'::jsonb,
    "dueDate" = "createdAt" + INTERVAL '30 days';

ALTER TABLE "Invoice"
  ALTER COLUMN "customer" SET NOT NULL,
  ALTER COLUMN "metadata" SET NOT NULL,
  ALTER COLUMN "dueDate" SET NOT NULL;

ALTER TABLE "QuoteSnapshot"
  ADD COLUMN "invoiceId" UUID;

ALTER TABLE "PaymentAttempt"
  DROP CONSTRAINT "PaymentAttempt_invoiceId_fkey";

CREATE UNIQUE INDEX "Invoice_id_organizationId_key"
  ON "Invoice"("id", "organizationId");
CREATE INDEX "QuoteSnapshot_organizationId_invoiceId_idx"
  ON "QuoteSnapshot"("organizationId", "invoiceId");

ALTER TABLE "QuoteSnapshot"
  ADD CONSTRAINT "QuoteSnapshot_invoiceId_organizationId_fkey"
  FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "Invoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_invoiceId_organizationId_fkey"
  FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "Invoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
