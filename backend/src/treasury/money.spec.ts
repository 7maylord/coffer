import {
  calculateFeeAtomic,
  formatAtomicAmount,
  parseAtomicAmount,
  parseDisplayAmount,
  splitAtomicAmount,
} from './money.js';

describe('exact money', () => {
  it('T-LED-05 converts mixed token decimals without floating point', () => {
    expect(parseDisplayAmount('1.000001', 6)).toBe(1_000_001n);
    expect(parseDisplayAmount('1.000000000000000000000001', 24)).toBe(
      1_000_000_000_000_000_000_000_001n,
    );
    expect(formatAtomicAmount(1_000_001n, 6)).toBe('1.000001');
    expect(formatAtomicAmount(1_000_000_000_000_000_000_000_001n, 24)).toBe(
      '1.000000000000000000000001',
    );
    expect(() => parseDisplayAmount('1.0000001', 6)).toThrow(
      'excess precision',
    );
    expect(() => parseAtomicAmount('01')).toThrow('canonical');
    expect(() => parseAtomicAmount('1e6')).toThrow('canonical');
  });

  it('calculates explicit fee rounding using integer arithmetic', () => {
    expect(calculateFeeAtomic(101n, 100, 'down')).toBe(1n);
    expect(calculateFeeAtomic(101n, 100, 'up')).toBe(2n);
  });

  it('T-LED-06 assigns a three-way rounding remainder deterministically', () => {
    expect(
      splitAtomicAmount(
        10_001n,
        [
          { recipientId: 'payroll', basisPoints: 5000 },
          { recipientId: 'operations', basisPoints: 3000 },
          { recipientId: 'partners', basisPoints: 2000 },
        ],
        'partners',
      ),
    ).toEqual([
      { recipientId: 'payroll', basisPoints: 5000, amountAtomic: '5000' },
      { recipientId: 'operations', basisPoints: 3000, amountAtomic: '3000' },
      { recipientId: 'partners', basisPoints: 2000, amountAtomic: '2001' },
    ]);
  });

  it('rejects invalid split weights and ambiguous recipients', () => {
    expect(() =>
      splitAtomicAmount(
        100n,
        [
          { recipientId: 'a', basisPoints: 5000 },
          { recipientId: 'b', basisPoints: 4999 },
        ],
        'b',
      ),
    ).toThrow('sum to 10000');
    expect(() =>
      splitAtomicAmount(
        100n,
        [
          { recipientId: 'a', basisPoints: 5000 },
          { recipientId: 'a', basisPoints: 5000 },
        ],
        'a',
      ),
    ).toThrow('unique');
  });

  it('rejects zero, overflow, invalid decimal and fee boundaries', () => {
    expect(() => parseAtomicAmount('0')).toThrow('positive');
    expect(() => parseAtomicAmount('9'.repeat(79))).toThrow('canonical');
    expect(() => parseDisplayAmount('1.', 6)).toThrow('canonical');
    expect(() => formatAtomicAmount(-1n, 6)).toThrow('outside');
    expect(() => formatAtomicAmount(1n, 78)).toThrow('Decimals');
    expect(() => calculateFeeAtomic(1n, 10_001, 'down')).toThrow(
      'Basis points',
    );
    expect(formatAtomicAmount(25n, 0)).toBe('25');
  });
});
