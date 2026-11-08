CREATE TABLE "IntentsSwap" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "originAssetId" TEXT NOT NULL,
    "destinationAssetId" TEXT NOT NULL,
    "originTokenContract" TEXT NOT NULL,
    "amountInAtomic" DECIMAL(78,0) NOT NULL,
    "amountOutAtomic" DECIMAL(78,0) NOT NULL,
    "minAmountOutAtomic" DECIMAL(78,0) NOT NULL,
    "recipient" TEXT NOT NULL,
    "refundTo" TEXT NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "depositAddress" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "depositTransactionHash" TEXT,
    "providerStatus" TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "internalStatus" TEXT NOT NULL DEFAULT 'AWAITING_DEPOSIT',
    "providerUpdatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntentsSwap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntentsSwapObservation" (
    "id" UUID NOT NULL,
    "intentsSwapId" UUID NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "controlledPayload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentsSwapObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntentsSwap_organizationId_idempotencyKey_key" ON "IntentsSwap"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "IntentsSwap_provider_correlationId_key" ON "IntentsSwap"("provider", "correlationId");
CREATE UNIQUE INDEX "IntentsSwap_provider_depositTransactionHash_key" ON "IntentsSwap"("provider", "depositTransactionHash");
CREATE INDEX "IntentsSwap_organizationId_createdAt_idx" ON "IntentsSwap"("organizationId", "createdAt");
CREATE UNIQUE INDEX "IntentsSwapObservation_intentsSwapId_providerEventId_key" ON "IntentsSwapObservation"("intentsSwapId", "providerEventId");
CREATE INDEX "IntentsSwapObservation_intentsSwapId_observedAt_idx" ON "IntentsSwapObservation"("intentsSwapId", "observedAt");

ALTER TABLE "IntentsSwap" ADD CONSTRAINT "IntentsSwap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntentsSwap" ADD CONSTRAINT "IntentsSwap_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntentsSwapObservation" ADD CONSTRAINT "IntentsSwapObservation_intentsSwapId_fkey" FOREIGN KEY ("intentsSwapId") REFERENCES "IntentsSwap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
