ALTER TABLE "PayrollPayoutItem"
  DROP CONSTRAINT "PayrollPayoutItem_verification_check",
  ADD CONSTRAINT "PayrollPayoutItem_verification_check" CHECK (
    ("status" = 'VERIFIED' AND "transactionHash" IS NOT NULL AND "evidenceDigest" IS NOT NULL AND "verifiedAt" IS NOT NULL) OR
    ("status" = 'RECONCILING' AND "transactionHash" IS NOT NULL AND "evidenceDigest" IS NULL AND "verifiedAt" IS NULL) OR
    ("status" = 'PREPARED' AND "transactionHash" IS NULL AND "evidenceDigest" IS NULL AND "verifiedAt" IS NULL)
  );
