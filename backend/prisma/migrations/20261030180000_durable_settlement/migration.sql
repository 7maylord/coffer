BEGIN;

CREATE TYPE "SettlementPostingKind" AS ENUM ('SETTLEMENT', 'REFUND');
CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'RESOLVED');

ALTER TABLE "PaymentAttempt"
  ADD COLUMN "pollCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OutboxEvent"
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "lastErrorCode" TEXT;

DROP INDEX "OutboxEvent_publishedAt_createdAt_idx";
CREATE INDEX "OutboxEvent_publishedAt_availableAt_createdAt_idx"
  ON "OutboxEvent"("publishedAt", "availableAt", "createdAt");

CREATE TABLE "PaymentStatusHistory" (
  "id" UUID NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboxEvent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementPosting" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "kind" "SettlementPostingKind" NOT NULL,
  "assetId" TEXT NOT NULL,
  "amountAtomic" DECIMAL(78,0) NOT NULL,
  "journalId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SettlementPosting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationCase" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "paymentAttemptId" UUID NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ReconciliationCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentStatusHistory_paymentAttemptId_providerEventId_status_key"
  ON "PaymentStatusHistory"("paymentAttemptId", "providerEventId", "status");
CREATE INDEX "PaymentStatusHistory_paymentAttemptId_observedAt_idx"
  ON "PaymentStatusHistory"("paymentAttemptId", "observedAt");
CREATE UNIQUE INDEX "InboxEvent_source_externalEventId_key"
  ON "InboxEvent"("source", "externalEventId");
CREATE INDEX "InboxEvent_organizationId_receivedAt_idx"
  ON "InboxEvent"("organizationId", "receivedAt");
CREATE UNIQUE INDEX "SettlementPosting_paymentAttemptId_kind_key"
  ON "SettlementPosting"("paymentAttemptId", "kind");
CREATE INDEX "SettlementPosting_organizationId_createdAt_idx"
  ON "SettlementPosting"("organizationId", "createdAt");
CREATE UNIQUE INDEX "ReconciliationCase_paymentAttemptId_key"
  ON "ReconciliationCase"("paymentAttemptId");
CREATE INDEX "ReconciliationCase_organizationId_status_createdAt_idx"
  ON "ReconciliationCase"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "OutboxEvent_topic_aggregateId_key"
  ON "OutboxEvent"("topic", "aggregateId");

ALTER TABLE "PaymentStatusHistory"
  ADD CONSTRAINT "PaymentStatusHistory_paymentAttemptId_fkey"
  FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InboxEvent"
  ADD CONSTRAINT "InboxEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementPosting"
  ADD CONSTRAINT "SettlementPosting_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementPosting"
  ADD CONSTRAINT "SettlementPosting_paymentAttemptId_fkey"
  FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCase"
  ADD CONSTRAINT "ReconciliationCase_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationCase"
  ADD CONSTRAINT "ReconciliationCase_paymentAttemptId_fkey"
  FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
