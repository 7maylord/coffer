-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerNormalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "JournalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assetId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "LedgerAccountType" NOT NULL,
    "normalSide" "LedgerNormalSide" NOT NULL,
    "postedBalanceAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "reservedBalanceAtomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LedgerAccount_balances_nonnegative" CHECK ("postedBalanceAtomic" >= 0 AND "reservedBalanceAtomic" >= 0),
    CONSTRAINT "LedgerAccount_reservation_within_balance" CHECK ("reservedBalanceAtomic" <= "postedBalanceAtomic")
);

-- CreateTable
CREATE TABLE "JournalTransaction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assetId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reversalOfId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assetId" TEXT NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "side" "JournalSide" NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalLine_amount_positive" CHECK ("amountAtomic" > 0)
);

-- CreateTable
CREATE TABLE "BalanceReservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assetId" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BalanceReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BalanceReservation_amount_positive" CHECK ("amountAtomic" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_organizationId_assetId_code_key" ON "LedgerAccount"("organizationId", "assetId", "code");
CREATE UNIQUE INDEX "LedgerAccount_id_organizationId_assetId_key" ON "LedgerAccount"("id", "organizationId", "assetId");
CREATE INDEX "LedgerAccount_organizationId_assetId_idx" ON "LedgerAccount"("organizationId", "assetId");
CREATE UNIQUE INDEX "JournalTransaction_reversalOfId_key" ON "JournalTransaction"("reversalOfId");
CREATE UNIQUE INDEX "JournalTransaction_organizationId_reference_key" ON "JournalTransaction"("organizationId", "reference");
CREATE UNIQUE INDEX "JournalTransaction_id_organizationId_assetId_key" ON "JournalTransaction"("id", "organizationId", "assetId");
CREATE INDEX "JournalTransaction_organizationId_assetId_createdAt_idx" ON "JournalTransaction"("organizationId", "assetId", "createdAt");
CREATE INDEX "JournalLine_organizationId_assetId_transactionId_idx" ON "JournalLine"("organizationId", "assetId", "transactionId");
CREATE INDEX "JournalLine_organizationId_assetId_accountId_createdAt_idx" ON "JournalLine"("organizationId", "assetId", "accountId", "createdAt");
CREATE UNIQUE INDEX "BalanceReservation_organizationId_reference_key" ON "BalanceReservation"("organizationId", "reference");
CREATE INDEX "BalanceReservation_organizationId_assetId_accountId_status_idx" ON "BalanceReservation"("organizationId", "assetId", "accountId", "status");
CREATE INDEX "BalanceReservation_status_expiresAt_idx" ON "BalanceReservation"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalTransaction" ADD CONSTRAINT "JournalTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalTransaction" ADD CONSTRAINT "JournalTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_transactionId_organizationId_assetId_fkey" FOREIGN KEY ("transactionId", "organizationId", "assetId") REFERENCES "JournalTransaction"("id", "organizationId", "assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_organizationId_assetId_fkey" FOREIGN KEY ("accountId", "organizationId", "assetId") REFERENCES "LedgerAccount"("id", "organizationId", "assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BalanceReservation" ADD CONSTRAINT "BalanceReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BalanceReservation" ADD CONSTRAINT "BalanceReservation_accountId_organizationId_assetId_fkey" FOREIGN KEY ("accountId", "organizationId", "assetId") REFERENCES "LedgerAccount"("id", "organizationId", "assetId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce that every committed journal is balanced and has at least two lines.
CREATE FUNCTION "check_journal_balance"() RETURNS TRIGGER AS $$
DECLARE
    target_transaction UUID;
    line_count BIGINT;
    debit_total DECIMAL(78,0);
    credit_total DECIMAL(78,0);
BEGIN
    target_transaction := COALESCE(NEW."transactionId", OLD."transactionId");
    SELECT COUNT(*),
           COALESCE(SUM("amountAtomic") FILTER (WHERE "side" = 'DEBIT'), 0),
           COALESCE(SUM("amountAtomic") FILTER (WHERE "side" = 'CREDIT'), 0)
      INTO line_count, debit_total, credit_total
      FROM "JournalLine"
     WHERE "transactionId" = target_transaction;
    IF line_count < 2 OR debit_total <> credit_total THEN
        RAISE EXCEPTION 'journal transaction must contain at least two balanced lines';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalLine_balance_check"
AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_journal_balance"();

-- Posted journal facts are append-only. Corrections use a linked reversal.
CREATE FUNCTION "prevent_posted_journal_mutation"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'posted journal records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalLine_immutable"
BEFORE UPDATE OR DELETE ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_journal_mutation"();

CREATE TRIGGER "JournalTransaction_immutable"
BEFORE UPDATE OR DELETE ON "JournalTransaction"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_journal_mutation"();
