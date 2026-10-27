import type {
  JournalSide,
  LedgerAccountType,
  LedgerNormalSide,
  ReservationStatus,
} from '@prisma/client';

export const LEDGER_STORE = Symbol('LEDGER_STORE');

export class LedgerValidationError extends Error {}
export class LedgerConflictError extends Error {}
export class LedgerNotFoundError extends Error {}
export class InsufficientFundsError extends Error {}

export interface LedgerAccountView {
  id: string;
  organizationId: string;
  assetId: string;
  code: string;
  name: string;
  accountType: LedgerAccountType;
  normalSide: LedgerNormalSide;
  postedBalanceAtomic: string;
  reservedBalanceAtomic: string;
  availableBalanceAtomic: string;
  version: number;
}

export interface JournalLineInput {
  accountId: string;
  side: JournalSide;
  amountAtomic: string;
}

export interface JournalView {
  id: string;
  organizationId: string;
  assetId: string;
  reference: string;
  requestDigest: string;
  description: string;
  reversalOfId: string | null;
  reversedById: string | null;
  createdAt: Date;
  lines: JournalLineInput[];
}

export interface ReservationView {
  id: string;
  organizationId: string;
  assetId: string;
  accountId: string;
  reference: string;
  requestDigest: string;
  amountAtomic: string;
  status: ReservationStatus;
  expiresAt: Date | null;
  version: number;
}

export interface LedgerStore {
  listAccounts(organizationId: string): Promise<LedgerAccountView[]>;
  createAccount(input: {
    organizationId: string;
    assetId: string;
    code: string;
    name: string;
    accountType: LedgerAccountType;
    normalSide: LedgerNormalSide;
  }): Promise<LedgerAccountView>;
  getAccount(input: {
    organizationId: string;
    accountId: string;
  }): Promise<LedgerAccountView | null>;
  getAccountByCode(input: {
    organizationId: string;
    assetId: string;
    code: string;
  }): Promise<LedgerAccountView | null>;
  postJournal(input: {
    organizationId: string;
    assetId: string;
    reference: string;
    requestDigest: string;
    description: string;
    reversalOfId?: string;
    lines: JournalLineInput[];
  }): Promise<{ journal: JournalView; created: boolean }>;
  getJournal(input: {
    organizationId: string;
    journalId: string;
  }): Promise<JournalView | null>;
  reserve(input: {
    organizationId: string;
    assetId: string;
    accountId: string;
    reference: string;
    requestDigest: string;
    amountAtomic: string;
    expiresAt?: Date;
  }): Promise<{ reservation: ReservationView; created: boolean }>;
  releaseReservation(input: {
    organizationId: string;
    reservationId: string;
    releasedAt: Date;
  }): Promise<ReservationView | null>;
}
