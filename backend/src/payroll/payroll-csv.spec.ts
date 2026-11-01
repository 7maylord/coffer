import { parseSyntheticPayrollCsv } from './payroll-csv.js';

const header =
  'employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic';
const row =
  'EMP-001,11111111-1111-4111-8111-111111111111,Ada Example,Synthetic address,ada.testnet,1000000';

describe('strict synthetic payroll CSV', () => {
  it('parses only the exact bounded schema', () => {
    expect(parseSyntheticPayrollCsv(`${header}\n${row}\n`)).toEqual([
      expect.objectContaining({
        employeeCode: 'EMP-001',
        grossAmountAtomic: '1000000',
      }),
    ]);
  });

  it.each([
    ['extra column', `${header},secret\n${row},x`],
    ['negative amount', `${header}\n${row.replace('1000000', '-1')}`],
    ['float amount', `${header}\n${row.replace('1000000', '1.5')}`],
    ['formula injection', `${header}\n${row.replace('Ada Example', '=CMD()')}`],
    ['NUL byte', `${header}\n${row}\0`],
    ['unclosed quote', `${header}\n"${row}`],
  ])('T-PRV-01 rejects %s', (_label, csv) => {
    expect(() => parseSyntheticPayrollCsv(csv)).toThrow(
      expect.objectContaining({ code: 'PAYROLL_INVALID_IMPORT' }),
    );
  });

  it('T-PRV-02 rejects duplicate employee and user rows', () => {
    expect(() => parseSyntheticPayrollCsv(`${header}\n${row}\n${row}`)).toThrow(
      expect.objectContaining({ code: 'PAYROLL_INVALID_IMPORT' }),
    );
  });
});
