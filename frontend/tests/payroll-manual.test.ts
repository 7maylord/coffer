import assert from "node:assert/strict";
import test from "node:test";
import { manualPayrollCsv } from "../src/lib/payroll-manual.ts";

test("manual payroll serializes strict rows without changing exact amounts", () => {
  assert.equal(
    manualPayrollCsv([
      {
        employeeCode: "EMP-001",
        userId: "22222222-2222-4222-8222-222222222222",
        legalName: 'Ada "Example"',
        address: "12 Example Road, Lagos",
        payoutAccount: "employee.testnet",
        grossAmountAtomic: "1000000",
      },
    ]),
    [
      "employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic",
      'EMP-001,22222222-2222-4222-8222-222222222222,"Ada ""Example""","12 Example Road, Lagos",employee.testnet,1000000',
    ].join("\n"),
  );
});
