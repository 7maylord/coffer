import {
  JournalSide,
  LedgerAccountType,
  LedgerNormalSide,
} from '@prisma/client';
import { LedgerService } from './ledger.service.js';
import type { LedgerStore } from './ledger.types.js';

describe('LedgerService', () => {
  const createAccount = vi.fn();
  const getAccount = vi.fn();
  const postJournal = vi.fn();
  const getJournal = vi.fn();
  const reserve = vi.fn();
  const releaseReservation = vi.fn();
  const store = {
    createAccount,
    getAccount,
    postJournal,
    getJournal,
    reserve,
    releaseReservation,
  } as unknown as LedgerStore;
  const service = new LedgerService(store);

  beforeEach(() => vi.clearAllMocks());

  it('derives the normal side from the account type', async () => {
    createAccount.mockResolvedValueOnce({ id: 'account_1' });
    await service.createAccount({
      organizationId: 'org_1',
      assetId: 'mock:near:usdc',
      code: 'TREASURY',
      name: ' Treasury ',
      accountType: LedgerAccountType.ASSET,
    });
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Treasury',
        normalSide: LedgerNormalSide.DEBIT,
      }),
    );
  });

  it('T-LED-01 rejects an unbalanced or noncanonical journal before storage', () => {
    expect(() =>
      service.post({
        organizationId: 'org_1',
        assetId: 'mock:near:usdc',
        reference: 'journal:bad',
        description: 'Unbalanced',
        lines: [
          { accountId: 'a', side: JournalSide.DEBIT, amountAtomic: '10' },
          { accountId: 'b', side: JournalSide.CREDIT, amountAtomic: '9' },
        ],
      }),
    ).toThrow('must balance');
    expect(() =>
      service.post({
        organizationId: 'org_1',
        assetId: 'mock:near:usdc',
        reference: 'journal:leading-zero',
        description: 'Invalid amount',
        lines: [
          { accountId: 'a', side: JournalSide.DEBIT, amountAtomic: '01' },
          { accountId: 'b', side: JournalSide.CREDIT, amountAtomic: '01' },
        ],
      }),
    ).toThrow('canonical');
    expect(postJournal).not.toHaveBeenCalled();
  });

  it('T-LED-06 builds a balanced deterministic split journal', async () => {
    postJournal.mockResolvedValueOnce({ created: true });
    await service.postSplit({
      organizationId: 'org_1',
      assetId: 'mock:near:usdc',
      sourceAccountId: 'treasury',
      amountAtomic: '10001',
      reference: 'split:2026-10',
      description: 'October allocation',
      remainderRecipientId: 'partners',
      shares: [
        { recipientId: 'payroll', accountId: 'payroll', basisPoints: 5000 },
        {
          recipientId: 'operations',
          accountId: 'operations',
          basisPoints: 3000,
        },
        { recipientId: 'partners', accountId: 'partners', basisPoints: 2000 },
      ],
    });
    expect(postJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          {
            accountId: 'treasury',
            side: JournalSide.CREDIT,
            amountAtomic: '10001',
          },
          {
            accountId: 'payroll',
            side: JournalSide.DEBIT,
            amountAtomic: '5000',
          },
          {
            accountId: 'operations',
            side: JournalSide.DEBIT,
            amountAtomic: '3000',
          },
          {
            accountId: 'partners',
            side: JournalSide.DEBIT,
            amountAtomic: '2001',
          },
        ],
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('binds reservation idempotency to the complete request', async () => {
    reserve.mockResolvedValueOnce({ created: true });
    await service.reserve({
      organizationId: 'org_1',
      assetId: 'mock:near:usdc',
      accountId: 'treasury',
      reference: 'reserve:payroll',
      amountAtomic: '500',
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        amountAtomic: '500',
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('fails closed for unknown journals and direct reversal chains', async () => {
    getJournal.mockResolvedValueOnce(null);
    await expect(
      service.reverse({
        organizationId: 'org_1',
        originalJournalId: 'missing',
        reference: 'reverse:missing',
      }),
    ).rejects.toThrow('not found');

    getJournal.mockResolvedValueOnce({
      id: 'reversal_1',
      organizationId: 'org_1',
      assetId: 'mock:near:usdc',
      reference: 'reverse:one',
      requestDigest: '0'.repeat(64),
      description: 'Existing reversal',
      reversalOfId: 'original_1',
      reversedById: null,
      createdAt: new Date(),
      lines: [],
    });
    await expect(
      service.reverse({
        organizationId: 'org_1',
        originalJournalId: 'reversal_1',
        reference: 'reverse:twice',
      }),
    ).rejects.toThrow('cannot be reversed');
  });

  it('rejects invalid account and expired reservation inputs', () => {
    expect(() =>
      service.createAccount({
        organizationId: 'org_1',
        assetId: 'mock:near:usdc',
        code: 'bad code',
        name: 'Bad',
        accountType: LedgerAccountType.ASSET,
      }),
    ).toThrow('account code');
    expect(() =>
      service.reserve({
        organizationId: 'org_1',
        assetId: 'mock:near:usdc',
        accountId: 'treasury',
        reference: 'reserve:expired',
        amountAtomic: '1',
        expiresAt: new Date(0),
      }),
    ).toThrow('future');
  });
});
