-- CreateEnum
CREATE TYPE "PolicyDecisionOutcome" AS ENUM ('ALLOW', 'DENY', 'REQUIRES_APPROVAL');

-- CreateEnum
CREATE TYPE "FinancialProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED', 'STALE_POLICY');

-- DropIndex
DROP INDEX "OrganizationInvite_network_targetNearAccountId_expiresAt_idx";

-- CreateTable
CREATE TABLE "PolicyDefinition" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "policyDefinitionId" UUID,
    "proposalId" UUID,
    "actorUserId" UUID NOT NULL,
    "outcome" "PolicyDecisionOutcome" NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "inputsDigest" TEXT NOT NULL,
    "inputSummary" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "proposalKey" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "proposalType" TEXT NOT NULL,
    "status" "FinancialProposalStatus" NOT NULL DEFAULT 'PENDING',
    "policyDefinitionId" UUID NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "policyDigest" TEXT NOT NULL,
    "organizationCommitment" TEXT NOT NULL,
    "proposalIdCommitment" TEXT NOT NULL,
    "instructionDigest" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "authorizedMaxAtomic" DECIMAL(78,0) NOT NULL,
    "recipientCommitment" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "nonceCommitment" TEXT NOT NULL,
    "idempotencyKeyCommitment" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "agentId" TEXT,
    "vendorId" TEXT,
    "approvalThreshold" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "supersedesId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalApproval" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "approverUserId" UUID NOT NULL,
    "approverNearAccountId" TEXT NOT NULL,
    "approvedInstructionDigest" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyContractBinding" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "network" TEXT NOT NULL,
    "contractAccountId" TEXT NOT NULL,
    "expectedCodeHash" TEXT NOT NULL,
    "organizationCommitment" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyContractBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDefinition_id_organizationId_key" ON "PolicyDefinition"("id", "organizationId");

-- CreateIndex
CREATE INDEX "PolicyDefinition_organizationId_supersededAt_idx" ON "PolicyDefinition"("organizationId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDefinition_organizationId_version_key" ON "PolicyDefinition"("organizationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDefinition_organizationId_digest_key" ON "PolicyDefinition"("organizationId", "digest");

-- CreateIndex
CREATE INDEX "PolicyDecision_organizationId_createdAt_idx" ON "PolicyDecision"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyDecision_organizationId_inputsDigest_idx" ON "PolicyDecision"("organizationId", "inputsDigest");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProposal_id_organizationId_key" ON "FinancialProposal"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProposal_instructionDigest_key" ON "FinancialProposal"("instructionDigest");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProposal_supersedesId_key" ON "FinancialProposal"("supersedesId");

-- CreateIndex
CREATE INDEX "FinancialProposal_organizationId_status_createdAt_idx" ON "FinancialProposal"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialProposal_organizationId_assetId_createdAt_idx" ON "FinancialProposal"("organizationId", "assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProposal_organizationId_proposalKey_revision_key" ON "FinancialProposal"("organizationId", "proposalKey", "revision");

-- CreateIndex
CREATE INDEX "ProposalApproval_organizationId_proposalId_idx" ON "ProposalApproval"("organizationId", "proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalApproval_proposalId_approverUserId_key" ON "ProposalApproval"("proposalId", "approverUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyContractBinding_organizationId_key" ON "PolicyContractBinding"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyContractBinding_network_contractAccountId_key" ON "PolicyContractBinding"("network", "contractAccountId");

-- AddForeignKey
ALTER TABLE "PolicyDefinition" ADD CONSTRAINT "PolicyDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDefinition" ADD CONSTRAINT "PolicyDefinition_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_policyDefinitionId_fkey" FOREIGN KEY ("policyDefinitionId") REFERENCES "PolicyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "FinancialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProposal" ADD CONSTRAINT "FinancialProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProposal" ADD CONSTRAINT "FinancialProposal_policyDefinitionId_organizationId_fkey" FOREIGN KEY ("policyDefinitionId", "organizationId") REFERENCES "PolicyDefinition"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProposal" ADD CONSTRAINT "FinancialProposal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProposal" ADD CONSTRAINT "FinancialProposal_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "FinancialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApproval" ADD CONSTRAINT "ProposalApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApproval" ADD CONSTRAINT "ProposalApproval_proposalId_organizationId_fkey" FOREIGN KEY ("proposalId", "organizationId") REFERENCES "FinancialProposal"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApproval" ADD CONSTRAINT "ProposalApproval_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyContractBinding" ADD CONSTRAINT "PolicyContractBinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial-policy integrity checks
ALTER TABLE "PolicyDefinition"
  ADD CONSTRAINT "PolicyDefinition_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PolicyDefinition_digest_check" CHECK ("digest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "PolicyDecision"
  ADD CONSTRAINT "PolicyDecision_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PolicyDecision_inputsDigest_check" CHECK ("inputsDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "FinancialProposal"
  ADD CONSTRAINT "FinancialProposal_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "FinancialProposal_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "FinancialProposal_threshold_check" CHECK ("approvalThreshold" > 0),
  ADD CONSTRAINT "FinancialProposal_amount_check" CHECK ("amountAtomic" > 0 AND "authorizedMaxAtomic" >= "amountAtomic"),
  ADD CONSTRAINT "FinancialProposal_commitments_check" CHECK (
    "policyDigest" ~ '^[0-9a-f]{64}$' AND
    "organizationCommitment" ~ '^[0-9a-f]{64}$' AND
    "proposalIdCommitment" ~ '^[0-9a-f]{64}$' AND
    "instructionDigest" ~ '^[0-9a-f]{64}$' AND
    "recipientCommitment" ~ '^[0-9a-f]{64}$' AND
    "nonceCommitment" ~ '^[0-9a-f]{64}$' AND
    "idempotencyKeyCommitment" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "ProposalApproval"
  ADD CONSTRAINT "ProposalApproval_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "ProposalApproval_digest_check" CHECK ("approvedInstructionDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "PolicyContractBinding"
  ADD CONSTRAINT "PolicyContractBinding_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PolicyContractBinding_commitment_check" CHECK ("organizationCommitment" ~ '^[0-9a-f]{64}$');

-- Audit facts are append-only. Policy supersession and proposal lifecycle are the
-- only permitted mutations; material proposal fields require a new revision.
CREATE FUNCTION prevent_policy_fact_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION restrict_policy_definition_update() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."organizationId", NEW."version", NEW."digest", NEW."rules", NEW."createdByUserId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."organizationId", OLD."version", OLD."digest", OLD."rules", OLD."createdByUserId", OLD."createdAt") THEN
    RAISE EXCEPTION 'policy definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION restrict_financial_proposal_update() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."organizationId", NEW."proposalKey", NEW."revision", NEW."proposalType", NEW."policyDefinitionId", NEW."policyVersion", NEW."policyDigest", NEW."organizationCommitment", NEW."proposalIdCommitment", NEW."instructionDigest", NEW."chainId", NEW."assetId", NEW."amountAtomic", NEW."authorizedMaxAtomic", NEW."recipientCommitment", NEW."expiresAt", NEW."nonceCommitment", NEW."idempotencyKeyCommitment", NEW."operation", NEW."environment", NEW."agentId", NEW."vendorId", NEW."approvalThreshold", NEW."createdByUserId", NEW."supersedesId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."organizationId", OLD."proposalKey", OLD."revision", OLD."proposalType", OLD."policyDefinitionId", OLD."policyVersion", OLD."policyDigest", OLD."organizationCommitment", OLD."proposalIdCommitment", OLD."instructionDigest", OLD."chainId", OLD."assetId", OLD."amountAtomic", OLD."authorizedMaxAtomic", OLD."recipientCommitment", OLD."expiresAt", OLD."nonceCommitment", OLD."idempotencyKeyCommitment", OLD."operation", OLD."environment", OLD."agentId", OLD."vendorId", OLD."approvalThreshold", OLD."createdByUserId", OLD."supersedesId", OLD."createdAt") THEN
    RAISE EXCEPTION 'material proposal fields require a new revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION enforce_policy_decision_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW."policyDefinitionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PolicyDefinition" p WHERE p."id" = NEW."policyDefinitionId" AND p."organizationId" = NEW."organizationId"
  ) THEN RAISE EXCEPTION 'cross-tenant policy decision'; END IF;
  IF NEW."proposalId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FinancialProposal" p WHERE p."id" = NEW."proposalId" AND p."organizationId" = NEW."organizationId"
  ) THEN RAISE EXCEPTION 'cross-tenant proposal decision'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PolicyDefinition_restrict_update" BEFORE UPDATE ON "PolicyDefinition" FOR EACH ROW EXECUTE FUNCTION restrict_policy_definition_update();
CREATE TRIGGER "PolicyDefinition_prevent_delete" BEFORE DELETE ON "PolicyDefinition" FOR EACH ROW EXECUTE FUNCTION prevent_policy_fact_mutation();
CREATE TRIGGER "PolicyDecision_enforce_tenant" BEFORE INSERT ON "PolicyDecision" FOR EACH ROW EXECUTE FUNCTION enforce_policy_decision_tenant();
CREATE TRIGGER "PolicyDecision_prevent_update_delete" BEFORE UPDATE OR DELETE ON "PolicyDecision" FOR EACH ROW EXECUTE FUNCTION prevent_policy_fact_mutation();
CREATE TRIGGER "FinancialProposal_restrict_update" BEFORE UPDATE ON "FinancialProposal" FOR EACH ROW EXECUTE FUNCTION restrict_financial_proposal_update();
CREATE TRIGGER "FinancialProposal_prevent_delete" BEFORE DELETE ON "FinancialProposal" FOR EACH ROW EXECUTE FUNCTION prevent_policy_fact_mutation();
CREATE TRIGGER "ProposalApproval_prevent_update_delete" BEFORE UPDATE OR DELETE ON "ProposalApproval" FOR EACH ROW EXECUTE FUNCTION prevent_policy_fact_mutation();
