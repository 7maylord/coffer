BEGIN;

ALTER TABLE "OrganizationInvite"
ADD COLUMN "network" TEXT NOT NULL DEFAULT 'testnet';

ALTER TABLE "OrganizationInvite"
ALTER COLUMN "network" DROP DEFAULT;

CREATE INDEX "OrganizationInvite_network_targetNearAccountId_expiresAt_idx"
ON "OrganizationInvite"("network", "targetNearAccountId", "expiresAt");

COMMIT;
