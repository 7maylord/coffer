BEGIN;

CREATE TYPE "CfoInferenceStatus" AS ENUM ('VALIDATED', 'INVALID', 'FAILED');
CREATE TYPE "CfoProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "AgentPurchaseStatus" AS ENUM ('CLAIMED', 'AWAITING_APPROVAL', 'COMPLETED', 'DENIED', 'FAILED');

CREATE TABLE "CfoInferenceRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputClassification" TEXT NOT NULL,
    "promptTemplateVersion" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "responseDigest" TEXT,
    "providerRequestId" TEXT,
    "attestationStatus" TEXT NOT NULL,
    "status" "CfoInferenceStatus" NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CfoInferenceRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CfoAllocationProposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inferenceRunId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "sourceAccountId" UUID NOT NULL,
    "reservationId" UUID,
    "assetId" TEXT NOT NULL,
    "maximumAmountAtomic" DECIMAL(78,0) NOT NULL,
    "allocations" JSONB NOT NULL,
    "supportingRecordIds" JSONB NOT NULL,
    "status" "CfoProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CfoAllocationProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentIdentity" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowedActions" JSONB NOT NULL,
    "assetId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "maxAmountAtomic" DECIMAL(78,0) NOT NULL,
    "rollingBudgetAtomic" DECIMAL(78,0) NOT NULL,
    "vendorAllowlist" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceOffer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "vendorId" TEXT NOT NULL,
    "externalOfferId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "offerDigest" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "priceAtomic" DECIMAL(78,0) NOT NULL,
    "recipientCommitment" TEXT NOT NULL,
    "controlledTerms" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentPurchase" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "financialProposalId" UUID,
    "status" "AgentPurchaseStatus" NOT NULL DEFAULT 'CLAIMED',
    "requestDigest" TEXT NOT NULL,
    "failureCode" TEXT,
    "mockPaymentReference" TEXT,
    "deliverable" JSONB,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CfoInferenceRun_organizationId_createdAt_idx" ON "CfoInferenceRun"("organizationId", "createdAt");
CREATE INDEX "CfoInferenceRun_organizationId_status_idx" ON "CfoInferenceRun"("organizationId", "status");
CREATE UNIQUE INDEX "CfoAllocationProposal_inferenceRunId_key" ON "CfoAllocationProposal"("inferenceRunId");
CREATE UNIQUE INDEX "CfoAllocationProposal_reservationId_key" ON "CfoAllocationProposal"("reservationId");
CREATE UNIQUE INDEX "CfoAllocationProposal_id_organizationId_key" ON "CfoAllocationProposal"("id", "organizationId");
CREATE INDEX "CfoAllocationProposal_organizationId_status_createdAt_idx" ON "CfoAllocationProposal"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "AgentIdentity_id_organizationId_key" ON "AgentIdentity"("id", "organizationId");
CREATE INDEX "AgentIdentity_organizationId_status_expiresAt_idx" ON "AgentIdentity"("organizationId", "status", "expiresAt");
CREATE UNIQUE INDEX "ServiceOffer_offerDigest_key" ON "ServiceOffer"("offerDigest");
CREATE UNIQUE INDEX "ServiceOffer_id_organizationId_key" ON "ServiceOffer"("id", "organizationId");
CREATE UNIQUE INDEX "ServiceOffer_organizationId_vendorId_externalOfferId_key" ON "ServiceOffer"("organizationId", "vendorId", "externalOfferId");
CREATE INDEX "ServiceOffer_organizationId_agentId_expiresAt_idx" ON "ServiceOffer"("organizationId", "agentId", "expiresAt");
CREATE UNIQUE INDEX "AgentPurchase_offerId_key" ON "AgentPurchase"("offerId");
CREATE UNIQUE INDEX "AgentPurchase_financialProposalId_key" ON "AgentPurchase"("financialProposalId");
CREATE UNIQUE INDEX "AgentPurchase_id_organizationId_key" ON "AgentPurchase"("id", "organizationId");
CREATE UNIQUE INDEX "AgentPurchase_offerId_organizationId_key" ON "AgentPurchase"("offerId", "organizationId");
CREATE INDEX "AgentPurchase_organizationId_status_createdAt_idx" ON "AgentPurchase"("organizationId", "status", "createdAt");

ALTER TABLE "CfoInferenceRun" ADD CONSTRAINT "CfoInferenceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoInferenceRun" ADD CONSTRAINT "CfoInferenceRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoAllocationProposal" ADD CONSTRAINT "CfoAllocationProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoAllocationProposal" ADD CONSTRAINT "CfoAllocationProposal_inferenceRunId_fkey" FOREIGN KEY ("inferenceRunId") REFERENCES "CfoInferenceRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoAllocationProposal" ADD CONSTRAINT "CfoAllocationProposal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoAllocationProposal" ADD CONSTRAINT "CfoAllocationProposal_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoAllocationProposal" ADD CONSTRAINT "CfoAllocationProposal_sourceAccountId_organizationId_assetId_fkey" FOREIGN KEY ("sourceAccountId", "organizationId", "assetId") REFERENCES "LedgerAccount"("id", "organizationId", "assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CfoAllocationProposal" ADD CONSTRAINT "CfoAllocationProposal_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "BalanceReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentIdentity" ADD CONSTRAINT "AgentIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentIdentity" ADD CONSTRAINT "AgentIdentity_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOffer" ADD CONSTRAINT "ServiceOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOffer" ADD CONSTRAINT "ServiceOffer_agentId_organizationId_fkey" FOREIGN KEY ("agentId", "organizationId") REFERENCES "AgentIdentity"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentPurchase" ADD CONSTRAINT "AgentPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentPurchase" ADD CONSTRAINT "AgentPurchase_agentId_organizationId_fkey" FOREIGN KEY ("agentId", "organizationId") REFERENCES "AgentIdentity"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentPurchase" ADD CONSTRAINT "AgentPurchase_offerId_organizationId_fkey" FOREIGN KEY ("offerId", "organizationId") REFERENCES "ServiceOffer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentPurchase" ADD CONSTRAINT "AgentPurchase_financialProposalId_fkey" FOREIGN KEY ("financialProposalId") REFERENCES "FinancialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
