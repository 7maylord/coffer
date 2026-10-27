export const MAX_ATOMIC_AMOUNT = 10n ** 78n - 1n;
export const BASIS_POINTS_SCALE = 10_000n;

export class MoneyValidationError extends Error {}

export function parseAtomicAmount(
  value: string,
  options: { allowZero?: boolean } = {},
): bigint {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) {
    throw new MoneyValidationError('Amount must be a canonical atomic integer');
  }
  const amount = BigInt(value);
  if (amount > MAX_ATOMIC_AMOUNT) {
    throw new MoneyValidationError('Amount exceeds NUMERIC(78,0)');
  }
  if (!options.allowZero && amount === 0n) {
    throw new MoneyValidationError('Amount must be positive');
  }
  return amount;
}

export function parseDisplayAmount(value: string, decimals: number): bigint {
  validateDecimals(decimals);
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new MoneyValidationError('Display amount is not canonical decimal');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    throw new MoneyValidationError('Display amount has excess precision');
  }
  const atomic = `${whole}${fraction.padEnd(decimals, '0')}`.replace(
    /^0+(?=\d)/,
    '',
  );
  return parseAtomicAmount(atomic || '0', { allowZero: true });
}

export function formatAtomicAmount(amount: bigint, decimals: number): string {
  validateDecimals(decimals);
  if (amount < 0n || amount > MAX_ATOMIC_AMOUNT) {
    throw new MoneyValidationError('Amount is outside supported range');
  }
  if (decimals === 0) return amount.toString();
  const padded = amount.toString().padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function calculateFeeAtomic(
  amount: bigint,
  basisPoints: number,
  rounding: 'down' | 'up',
): bigint {
  if (amount < 0n || amount > MAX_ATOMIC_AMOUNT) {
    throw new MoneyValidationError('Amount is outside supported range');
  }
  if (
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10_000
  ) {
    throw new MoneyValidationError(
      'Basis points must be an integer from 0 to 10000',
    );
  }
  const numerator = amount * BigInt(basisPoints);
  const quotient = numerator / BASIS_POINTS_SCALE;
  return rounding === 'up' && numerator % BASIS_POINTS_SCALE !== 0n
    ? quotient + 1n
    : quotient;
}

export interface SplitShare {
  recipientId: string;
  basisPoints: number;
}

export interface AtomicAllocation extends SplitShare {
  amountAtomic: string;
}

export function splitAtomicAmount(
  amount: bigint,
  shares: readonly SplitShare[],
  remainderRecipientId: string,
): AtomicAllocation[] {
  if (amount <= 0n || amount > MAX_ATOMIC_AMOUNT) {
    throw new MoneyValidationError('Split amount must be positive');
  }
  if (shares.length < 2 || shares.length > 100) {
    throw new MoneyValidationError('Split requires between 2 and 100 shares');
  }
  const recipientIds = new Set(shares.map(({ recipientId }) => recipientId));
  if (
    recipientIds.size !== shares.length ||
    !recipientIds.has(remainderRecipientId)
  ) {
    throw new MoneyValidationError(
      'Split recipients must be unique and include remainder recipient',
    );
  }
  let totalBasisPoints = 0;
  for (const share of shares) {
    if (
      share.recipientId.length === 0 ||
      !Number.isInteger(share.basisPoints) ||
      share.basisPoints <= 0
    ) {
      throw new MoneyValidationError('Split shares must be positive integers');
    }
    totalBasisPoints += share.basisPoints;
  }
  if (totalBasisPoints !== Number(BASIS_POINTS_SCALE)) {
    throw new MoneyValidationError(
      'Split shares must sum to 10000 basis points',
    );
  }

  const allocations = shares.map((share) => ({
    ...share,
    amount: (amount * BigInt(share.basisPoints)) / BASIS_POINTS_SCALE,
  }));
  const allocated = allocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0n,
  );
  const remainder = amount - allocated;
  return allocations.map((allocation) => ({
    recipientId: allocation.recipientId,
    basisPoints: allocation.basisPoints,
    amountAtomic: (
      allocation.amount +
      (allocation.recipientId === remainderRecipientId ? remainder : 0n)
    ).toString(),
  }));
}

function validateDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    throw new MoneyValidationError('Decimals must be an integer from 0 to 77');
  }
}
