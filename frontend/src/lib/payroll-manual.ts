export type ManualPayrollLine = {
  employeeCode: string;
  userId: string;
  legalName: string;
  address: string;
  payoutAccount: string;
  grossAmountAtomic: string;
};

const header =
  "employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic";

export function manualPayrollCsv(lines: ManualPayrollLine[]): string {
  return [
    header,
    ...lines.map((line) =>
      [
        line.employeeCode,
        line.userId,
        line.legalName,
        line.address,
        line.payoutAccount,
        line.grossAmountAtomic,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
