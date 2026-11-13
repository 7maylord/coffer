BEGIN;

ALTER TABLE "FinanceAgentRun"
  ADD CONSTRAINT "FinanceAgentRun_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "BalanceReservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
