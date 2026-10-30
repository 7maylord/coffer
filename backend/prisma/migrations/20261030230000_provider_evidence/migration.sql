BEGIN;

CREATE TABLE "ExternalTransferEvidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referenceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "signerAccountId" TEXT NOT NULL,
    "receiverAccountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amountAtomic" DECIMAL(78,0) NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalTransferEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalTransferEvidence_provider_network_transactionHash_key"
ON "ExternalTransferEvidence"("provider", "network", "transactionHash");

CREATE UNIQUE INDEX "ExternalTransferEvidence_organizationId_referenceId_key"
ON "ExternalTransferEvidence"("organizationId", "referenceId");

CREATE INDEX "ExternalTransferEvidence_organizationId_verifiedAt_idx"
ON "ExternalTransferEvidence"("organizationId", "verifiedAt");

ALTER TABLE "ExternalTransferEvidence"
ADD CONSTRAINT "ExternalTransferEvidence_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
