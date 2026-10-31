BEGIN;

CREATE OR REPLACE FUNCTION validate_agent_purchase_tenant_links()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."financialProposalId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "FinancialProposal" p
      WHERE p."id" = NEW."financialProposalId"
        AND p."organizationId" = NEW."organizationId"
        AND p."agentId" = NEW."agentId"::text
    ) THEN
      RAISE EXCEPTION 'Agent purchase financial proposal tenant or agent mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
