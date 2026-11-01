import { PayrollError, type ParsedPayrollRow } from './payroll.types.js';

const headers = [
  'employee_code',
  'user_id',
  'legal_name',
  'address',
  'payout_account',
  'gross_amount_atomic',
] as const;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const atomic = /^(?:0|[1-9][0-9]{0,77})$/;
const employeeCode = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function parseSyntheticPayrollCsv(csv: string): ParsedPayrollRow[] {
  if (Buffer.byteLength(csv, 'utf8') > 256_000 || csv.includes('\0')) {
    throw invalidCsv();
  }
  const table = parseCsv(csv);
  if (
    table.length < 2 ||
    table.length > 501 ||
    table[0]!.length !== headers.length ||
    !headers.every((header, index) => table[0]![index] === header)
  ) {
    throw invalidCsv();
  }
  const seenCodes = new Set<string>();
  const seenUsers = new Set<string>();
  return table.slice(1).map((columns) => {
    if (columns.length !== headers.length) throw invalidCsv();
    const [code, userId, legalName, address, payoutAccount, gross] = columns;
    if (
      !code ||
      !userId ||
      !legalName ||
      !address ||
      !payoutAccount ||
      !gross ||
      !employeeCode.test(code) ||
      !uuid.test(userId) ||
      !atomic.test(gross) ||
      !safeText(legalName, 120) ||
      !safeText(address, 300) ||
      !safeText(payoutAccount, 200) ||
      seenCodes.has(code) ||
      seenUsers.has(userId)
    ) {
      throw invalidCsv();
    }
    seenCodes.add(code);
    seenUsers.add(userId);
    return {
      employeeCode: code,
      userId,
      legalName,
      address,
      payoutAccount,
      grossAmountAtomic: gross,
    };
  });
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character === '\r') {
      if (value[index + 1] !== '\n') throw invalidCsv();
    } else if (character === '"') {
      throw invalidCsv();
    } else {
      field += character;
    }
  }
  if (quoted) throw invalidCsv();
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.some((candidate) => candidate.every((item) => item === ''))) {
    throw invalidCsv();
  }
  return rows;
}

function safeText(value: string, maximum: number): boolean {
  return (
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum &&
    !hasControlCharacter(value) &&
    !/^[=+@-]/.test(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function invalidCsv(): PayrollError {
  return new PayrollError(
    'PAYROLL_INVALID_IMPORT',
    'Payroll CSV does not match the strict synthetic schema',
  );
}
