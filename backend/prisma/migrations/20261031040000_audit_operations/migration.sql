BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "AuditEvent"
  ADD COLUMN "traceId" TEXT,
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "eventHash" TEXT NOT NULL DEFAULT '';

CREATE FUNCTION coffer_audit_hash(
  event_id UUID,
  organization_id UUID,
  event_sequence INTEGER,
  previous_hash TEXT,
  actor_id TEXT,
  event_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  correlation_id TEXT,
  trace_id TEXT,
  metadata JSONB,
  created_at TIMESTAMP(3)
) RETURNS TEXT AS $$
  SELECT encode(
    digest(
      concat_ws('|',
        'coffer:audit:v1', event_id::text, organization_id::text,
        event_sequence::text, coalesce(previous_hash, ''),
        coalesce(actor_id, ''), event_type, entity_type, entity_id,
        correlation_id, coalesce(trace_id, ''), metadata::text,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      'sha256'
    ),
    'hex'
  );
$$ LANGUAGE SQL IMMUTABLE;

DO $$
DECLARE
  organization_row RECORD;
  event_row RECORD;
  next_sequence INTEGER;
  prior_hash TEXT;
  computed_hash TEXT;
BEGIN
  FOR organization_row IN
    SELECT DISTINCT "organizationId" FROM "AuditEvent"
  LOOP
    next_sequence := 0;
    prior_hash := NULL;
    FOR event_row IN
      SELECT * FROM "AuditEvent"
      WHERE "organizationId" = organization_row."organizationId"
      ORDER BY "createdAt", "id"
    LOOP
      next_sequence := next_sequence + 1;
      computed_hash := coffer_audit_hash(
        event_row."id", event_row."organizationId", next_sequence,
        prior_hash, event_row."actorId", event_row."eventType",
        event_row."entityType", event_row."entityId",
        event_row."correlationId", event_row."correlationId",
        event_row."metadata", event_row."createdAt"
      );
      UPDATE "AuditEvent"
      SET "sequence" = next_sequence,
          "previousHash" = prior_hash,
          "eventHash" = computed_hash,
          "traceId" = "correlationId"
      WHERE "id" = event_row."id";
      prior_hash := computed_hash;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_sequence_positive" CHECK ("sequence" > 0),
  ADD CONSTRAINT "AuditEvent_event_hash_format" CHECK ("eventHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AuditEvent_previous_hash_format" CHECK ("previousHash" IS NULL OR "previousHash" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "AuditEvent_organizationId_sequence_key"
  ON "AuditEvent"("organizationId", "sequence");

CREATE FUNCTION chain_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  last_sequence INTEGER;
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."organizationId"::text, 0));
  SELECT "sequence", "eventHash" INTO last_sequence, last_hash
  FROM "AuditEvent"
  WHERE "organizationId" = NEW."organizationId"
  ORDER BY "sequence" DESC
  LIMIT 1;

  NEW."sequence" := coalesce(last_sequence, 0) + 1;
  NEW."previousHash" := last_hash;
  NEW."traceId" := coalesce(NEW."traceId", NEW."correlationId");
  NEW."eventHash" := coffer_audit_hash(
    NEW."id", NEW."organizationId", NEW."sequence", NEW."previousHash",
    NEW."actorId", NEW."eventType", NEW."entityType", NEW."entityId",
    NEW."correlationId", NEW."traceId", NEW."metadata", NEW."createdAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_chain_insert"
BEFORE INSERT ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION chain_audit_event();

CREATE FUNCTION reject_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('coffer.audit_reset', true) = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'AuditEvent rows are append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE FUNCTION append_business_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  row_data JSONB;
  organization_id UUID;
  entity_id TEXT;
  actor_id TEXT;
BEGIN
  row_data := to_jsonb(NEW);
  organization_id := (row_data ->> 'organizationId')::UUID;
  entity_id := row_data ->> 'id';
  actor_id := CASE WHEN TG_NARGS > 2 THEN row_data ->> TG_ARGV[2] ELSE NULL END;
  INSERT INTO "AuditEvent" (
    "id", "organizationId", "actorId", "eventType", "entityType",
    "entityId", "correlationId", "metadata", "createdAt"
  ) VALUES (
    gen_random_uuid(), organization_id, actor_id, TG_ARGV[0], TG_ARGV[1],
    entity_id, gen_random_uuid()::text,
    jsonb_build_object('operation', TG_OP), CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Membership_audit_insert"
AFTER INSERT ON "Membership"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'MEMBERSHIP_PERMISSION_CREATED', 'MEMBERSHIP'
);
CREATE TRIGGER "Membership_audit_update"
AFTER UPDATE OF "role", "revokedAt" ON "Membership"
FOR EACH ROW WHEN (OLD."role" IS DISTINCT FROM NEW."role" OR OLD."revokedAt" IS DISTINCT FROM NEW."revokedAt")
EXECUTE FUNCTION append_business_audit_event(
  'MEMBERSHIP_PERMISSION_CHANGED', 'MEMBERSHIP'
);
CREATE TRIGGER "FinancialProposal_audit_insert"
AFTER INSERT ON "FinancialProposal"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'FINANCIAL_PROPOSAL_CREATED', 'FINANCIAL_PROPOSAL', 'createdByUserId'
);
CREATE TRIGGER "ProposalApproval_audit_insert"
AFTER INSERT ON "ProposalApproval"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'PROPOSAL_APPROVAL_RECORDED', 'PROPOSAL_APPROVAL', 'approverUserId'
);
CREATE TRIGGER "AgentPurchase_audit_insert"
AFTER INSERT ON "AgentPurchase"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'AGENT_PURCHASE_PROPOSED', 'AGENT_PURCHASE'
);
CREATE TRIGGER "AgentPurchase_audit_update"
AFTER UPDATE OF "status" ON "AgentPurchase"
FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION append_business_audit_event(
  'AGENT_PURCHASE_STATUS_CHANGED', 'AGENT_PURCHASE'
);
CREATE TRIGGER "PaymentAttempt_audit_insert"
AFTER INSERT ON "PaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'PAYMENT_ATTEMPT_CREATED', 'PAYMENT_ATTEMPT'
);
CREATE TRIGGER "PaymentAttempt_audit_update"
AFTER UPDATE OF "status" ON "PaymentAttempt"
FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION append_business_audit_event(
  'PAYMENT_STATUS_CHANGED', 'PAYMENT_ATTEMPT'
);
CREATE TRIGGER "ReconciliationCase_audit_insert"
AFTER INSERT ON "ReconciliationCase"
FOR EACH ROW EXECUTE FUNCTION append_business_audit_event(
  'RECONCILIATION_CASE_OPENED', 'RECONCILIATION_CASE'
);
CREATE TRIGGER "ReconciliationCase_audit_update"
AFTER UPDATE OF "status" ON "ReconciliationCase"
FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION append_business_audit_event(
  'RECONCILIATION_CASE_STATUS_CHANGED', 'RECONCILIATION_CASE'
);

COMMIT;
