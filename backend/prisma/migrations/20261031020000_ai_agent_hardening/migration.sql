BEGIN;

ALTER TABLE "AgentIdentity"
  ADD COLUMN "rollingWindowSeconds" INTEGER NOT NULL DEFAULT 86400;

ALTER TABLE "AgentIdentity"
  ADD CONSTRAINT "AgentIdentity_positive_limits_check"
    CHECK ("maxAmountAtomic" > 0 AND "rollingBudgetAtomic" > 0),
  ADD CONSTRAINT "AgentIdentity_budget_bounds_check"
    CHECK ("maxAmountAtomic" <= "rollingBudgetAtomic"),
  ADD CONSTRAINT "AgentIdentity_rolling_window_check"
    CHECK ("rollingWindowSeconds" BETWEEN 60 AND 31536000);

ALTER TABLE "CfoAllocationProposal"
  ADD CONSTRAINT "CfoAllocationProposal_positive_maximum_check"
    CHECK ("maximumAmountAtomic" > 0);

ALTER TABLE "ServiceOffer"
  ADD CONSTRAINT "ServiceOffer_positive_price_check"
    CHECK ("priceAtomic" > 0),
  ADD CONSTRAINT "ServiceOffer_request_digest_check"
    CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ServiceOffer_offer_digest_check"
    CHECK ("offerDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AgentPurchase"
  ADD CONSTRAINT "AgentPurchase_request_digest_check"
    CHECK ("requestDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CfoInferenceRun"
  ADD CONSTRAINT "CfoInferenceRun_input_digest_check"
    CHECK ("inputDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "CfoInferenceRun_response_digest_check"
    CHECK ("responseDigest" IS NULL OR "responseDigest" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION reject_automation_append_only_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CfoInferenceRun_append_only"
BEFORE UPDATE ON "CfoInferenceRun"
FOR EACH ROW EXECUTE FUNCTION reject_automation_append_only_update();

CREATE TRIGGER "ServiceOffer_append_only"
BEFORE UPDATE ON "ServiceOffer"
FOR EACH ROW EXECUTE FUNCTION reject_automation_append_only_update();

CREATE FUNCTION guard_cfo_proposal_change()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."organizationId", NEW."inferenceRunId", NEW."createdByUserId",
    NEW."sourceAccountId", NEW."assetId", NEW."maximumAmountAtomic",
    NEW."allocations", NEW."supportingRecordIds", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."inferenceRunId", OLD."createdByUserId",
    OLD."sourceAccountId", OLD."assetId", OLD."maximumAmountAtomic",
    OLD."allocations", OLD."supportingRecordIds", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'CfoAllocationProposal immutable fields cannot change'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CfoAllocationProposal_guard_change"
BEFORE UPDATE ON "CfoAllocationProposal"
FOR EACH ROW EXECUTE FUNCTION guard_cfo_proposal_change();

CREATE FUNCTION guard_agent_identity_change()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."organizationId", NEW."ownerUserId", NEW."purpose", NEW."provider",
    NEW."allowedActions", NEW."assetId", NEW."chainId", NEW."maxAmountAtomic",
    NEW."rollingBudgetAtomic", NEW."rollingWindowSeconds",
    NEW."vendorAllowlist", NEW."expiresAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."ownerUserId", OLD."purpose", OLD."provider",
    OLD."allowedActions", OLD."assetId", OLD."chainId", OLD."maxAmountAtomic",
    OLD."rollingBudgetAtomic", OLD."rollingWindowSeconds",
    OLD."vendorAllowlist", OLD."expiresAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'AgentIdentity authority fields cannot change'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentIdentity_guard_change"
BEFORE UPDATE ON "AgentIdentity"
FOR EACH ROW EXECUTE FUNCTION guard_agent_identity_change();

CREATE FUNCTION guard_agent_purchase_change()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."organizationId", NEW."agentId", NEW."offerId",
    NEW."requestDigest", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."organizationId", OLD."agentId", OLD."offerId",
    OLD."requestDigest", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'AgentPurchase immutable fields cannot change'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentPurchase_guard_change"
BEFORE UPDATE ON "AgentPurchase"
FOR EACH ROW EXECUTE FUNCTION guard_agent_purchase_change();

CREATE FUNCTION validate_cfo_proposal_tenant_links()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "CfoInferenceRun" r
    WHERE r."id" = NEW."inferenceRunId"
      AND r."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'CFO inference run tenant mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."reservationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "BalanceReservation" r
    WHERE r."id" = NEW."reservationId"
      AND r."organizationId" = NEW."organizationId"
      AND r."assetId" = NEW."assetId"
  ) THEN
    RAISE EXCEPTION 'CFO reservation tenant or asset mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CfoAllocationProposal_validate_tenant_links"
BEFORE INSERT OR UPDATE ON "CfoAllocationProposal"
FOR EACH ROW EXECUTE FUNCTION validate_cfo_proposal_tenant_links();

CREATE FUNCTION validate_agent_purchase_tenant_links()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."financialProposalId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FinancialProposal" p
    WHERE p."id" = NEW."financialProposalId"
      AND p."organizationId" = NEW."organizationId"
      AND p."agentId" = NEW."agentId"
  ) THEN
    RAISE EXCEPTION 'Agent purchase financial proposal tenant or agent mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AgentPurchase_validate_tenant_links"
BEFORE INSERT OR UPDATE ON "AgentPurchase"
FOR EACH ROW EXECUTE FUNCTION validate_agent_purchase_tenant_links();

COMMIT;
