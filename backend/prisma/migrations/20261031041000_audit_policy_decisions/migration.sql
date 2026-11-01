BEGIN;

CREATE FUNCTION append_policy_decision_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "AuditEvent" (
    "id", "organizationId", "actorId", "eventType", "entityType",
    "entityId", "correlationId", "metadata", "createdAt"
  ) VALUES (
    gen_random_uuid(), NEW."organizationId", NEW."actorUserId",
    CASE
      WHEN NEW."outcome" = 'DENY' THEN 'POLICY_DECISION_DENIED'
      WHEN NEW."outcome" = 'ALLOW' THEN 'POLICY_DECISION_ALLOWED'
      ELSE 'POLICY_DECISION_REQUIRES_APPROVAL'
    END,
    'POLICY_DECISION', NEW."id"::text, gen_random_uuid()::text,
    jsonb_build_object(
      'outcome', NEW."outcome"::text,
      'inputsDigest', NEW."inputsDigest",
      'reasonCodes', NEW."reasonCodes"
    ),
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PolicyDecision_audit_insert"
AFTER INSERT ON "PolicyDecision"
FOR EACH ROW EXECUTE FUNCTION append_policy_decision_audit();

CREATE TRIGGER "CfoAllocationProposal_audit_decision"
AFTER UPDATE OF "status" ON "CfoAllocationProposal"
FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION append_business_audit_event(
  'CFO_PROPOSAL_DECISION_RECORDED', 'CFO_ALLOCATION_PROPOSAL', 'decidedByUserId'
);

COMMIT;
