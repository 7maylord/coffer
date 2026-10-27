-- A journal header with no lines does not fire the line-level constraint
-- trigger. Check every newly committed header as well so direct SQL cannot
-- create an empty posted transaction.
CREATE FUNCTION "check_journal_header_balance"() RETURNS TRIGGER AS $$
DECLARE
    line_count BIGINT;
    debit_total DECIMAL(78,0);
    credit_total DECIMAL(78,0);
BEGIN
    SELECT COUNT(*),
           COALESCE(SUM("amountAtomic") FILTER (WHERE "side" = 'DEBIT'), 0),
           COALESCE(SUM("amountAtomic") FILTER (WHERE "side" = 'CREDIT'), 0)
      INTO line_count, debit_total, credit_total
      FROM "JournalLine"
     WHERE "transactionId" = NEW."id";
    IF line_count < 2 OR debit_total <> credit_total THEN
        RAISE EXCEPTION 'journal transaction must contain at least two balanced lines';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalTransaction_balance_check"
AFTER INSERT ON "JournalTransaction"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_journal_header_balance"();
