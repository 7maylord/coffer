import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { LedgerAccountType } from '@prisma/client';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { PolicyService } from '../policy/policy.service.js';
import type { ProposalRecord } from '../policy/policy.types.js';
import { LedgerService } from './ledger.service.js';
import { InsufficientFundsError, LedgerNotFoundError } from './ledger.types.js';
import { parseAtomicAmount, splitAtomicAmount } from './money.js';

export const TREASURY_SPLIT_ASSET = 'mock:near:usdc';
export const TREASURY_SPLIT_CHAIN = 'internal:ledger';
export const TREASURY_SPLIT_OPERATION_PREFIX = 'reserve_split:';
export const TREASURY_SPLIT_SHARES = [
  { recipientId: 'payroll', basisPoints: 5_000 },
  { recipientId: 'operations', basisPoints: 3_000 },
  { recipientId: 'partner_distributions', basisPoints: 2_000 },
] as const;
export const TREASURY_SPLIT_REMAINDER = 'payroll';
export const TREASURY_SPLIT_COMMITMENT = createHash('sha256')
  .update(
    'coffer:treasury-split:v1\npayroll:5000\noperations:3000\npartner_distributions:2000\nremainder:payroll',
  )
  .digest('hex');

@Injectable()
export class TreasuryWorkflowService {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PolicyService) private readonly policies: PolicyService,
  ) {}

  async workspace(organizationId: string) {
    const [accounts, policy, allProposals] = await Promise.all([
      this.ledger.accounts(organizationId),
      this.policies.activeOrNull(organizationId),
      this.policies.list(organizationId),
    ]);
    return {
      balanceSource: 'ledger-derived internal' as const,
      custodyStatus: 'not on-chain verified' as const,
      asset: {
        assetId: TREASURY_SPLIT_ASSET,
        symbol: 'Mock USDC',
        decimals: 6,
        environment: 'mock' as const,
      },
      accounts: accounts.filter(
        (account) => account.assetId === TREASURY_SPLIT_ASSET,
      ),
      activePolicy: policy,
      proposals: allProposals.filter(
        (proposal) => proposal.proposalType === 'treasury_split',
      ),
      splitTemplate: {
        shares: TREASURY_SPLIT_SHARES,
        remainderRecipientId: TREASURY_SPLIT_REMAINDER,
        recipientCommitment: TREASURY_SPLIT_COMMITMENT,
      },
    };
  }

  preview(amountAtomic: string) {
    const amount = parseAtomicAmount(amountAtomic);
    return {
      amountAtomic: amount.toString(),
      allocations: splitAtomicAmount(
        amount,
        TREASURY_SPLIT_SHARES,
        TREASURY_SPLIT_REMAINDER,
      ),
      remainderRecipientId: TREASURY_SPLIT_REMAINDER,
      recipientCommitment: TREASURY_SPLIT_COMMITMENT,
    };
  }

  activatePolicy(
    actorUserId: string,
    organizationId: string,
    input: {
      perTransactionCapAtomic: string;
      rollingWindowCapAtomic: string;
      expiresAt: string;
    },
  ) {
    return this.policies.activate(actorUserId, organizationId, {
      assetLimits: {
        [TREASURY_SPLIT_ASSET]: {
          perTransactionCapAtomic: input.perTransactionCapAtomic,
          rollingWindowCapAtomic: input.rollingWindowCapAtomic,
          approvalRequiredAboveAtomic: '0',
        },
      },
      allowedChainIds: [TREASURY_SPLIT_CHAIN],
      allowedRecipientCommitments: [TREASURY_SPLIT_COMMITMENT],
      rollingWindowSeconds: 2_592_000,
      approvalThreshold: 2,
      agentCapsAtomic: {},
      vendorCapsAtomic: {},
      expiresAt: input.expiresAt,
      frozen: false,
    });
  }

  async createProposal(
    actorUserId: string,
    organizationId: string,
    input: { sourceAccountId: string; amountAtomic: string; expiresAt: string },
    idempotencyKey: string,
  ) {
    await this.assertSourceAccount(
      organizationId,
      input.sourceAccountId,
      input.amountAtomic,
    );
    return this.policies.create(
      actorUserId,
      organizationId,
      this.material(input, idempotencyKey),
    );
  }

  async reviseProposal(
    actorUserId: string,
    organizationId: string,
    proposalId: string,
    input: { sourceAccountId: string; amountAtomic: string; expiresAt: string },
    idempotencyKey: string,
  ) {
    const previous = await this.policies.get(organizationId, proposalId);
    this.assertTreasurySplit(previous);
    await this.assertSourceAccount(
      organizationId,
      input.sourceAccountId,
      input.amountAtomic,
    );
    return this.policies.revise(
      actorUserId,
      organizationId,
      proposalId,
      this.material(input, idempotencyKey),
    );
  }

  async approve(
    principal: SessionPrincipal,
    organizationId: string,
    proposalId: string,
    nearAccountId: string,
  ) {
    this.assertTreasurySplit(
      await this.policies.get(organizationId, proposalId),
    );
    return this.policies.approve(
      principal,
      organizationId,
      proposalId,
      nearAccountId,
    );
  }

  async cancel(organizationId: string, proposalId: string) {
    this.assertTreasurySplit(
      await this.policies.get(organizationId, proposalId),
    );
    return this.policies.cancel(organizationId, proposalId);
  }

  async reserve(organizationId: string, proposalId: string) {
    const proposal = await this.policies.get(organizationId, proposalId);
    this.assertTreasurySplit(proposal);
    const sourceAccountId = proposal.operation.slice(
      TREASURY_SPLIT_OPERATION_PREFIX.length,
    );
    await this.assertSourceAccount(
      organizationId,
      sourceAccountId,
      proposal.amountAtomic,
    );
    const verification = await this.policies.verifyForExecution(
      organizationId,
      proposalId,
    );
    try {
      const result = await this.ledger.reserve({
        organizationId,
        assetId: proposal.assetId,
        accountId: sourceAccountId,
        reference: `treasury-split:${proposal.id}`,
        amountAtomic: proposal.amountAtomic,
        expiresAt: proposal.expiresAt,
      });
      return {
        verification,
        reservation: result.reservation,
        created: result.created,
        split: this.preview(proposal.amountAtomic),
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictException('Available ledger balance is insufficient');
      }
      throw error;
    }
  }

  private material(
    input: { sourceAccountId: string; amountAtomic: string; expiresAt: string },
    idempotencyKey: string,
  ) {
    return {
      proposalType: 'treasury_split',
      chainId: TREASURY_SPLIT_CHAIN,
      assetId: TREASURY_SPLIT_ASSET,
      amountAtomic: input.amountAtomic,
      authorizedMaxAtomic: input.amountAtomic,
      recipientCommitment: TREASURY_SPLIT_COMMITMENT,
      expiresAt: new Date(input.expiresAt),
      nonceCommitment: hash(randomBytes(32)),
      idempotencyKeyCommitment: hash(idempotencyKey),
      operation: `${TREASURY_SPLIT_OPERATION_PREFIX}${input.sourceAccountId}`,
      environment: 'mock',
    };
  }

  private async assertSourceAccount(
    organizationId: string,
    accountId: string,
    amountAtomic: string,
  ) {
    try {
      const account = await this.ledger.account(organizationId, accountId);
      if (
        account.assetId !== TREASURY_SPLIT_ASSET ||
        account.accountType !== LedgerAccountType.ASSET
      ) {
        throw new BadRequestException('A Mock USDC asset account is required');
      }
      if (
        BigInt(account.availableBalanceAtomic) < parseAtomicAmount(amountAtomic)
      ) {
        throw new ConflictException('Split exceeds available ledger balance');
      }
    } catch (error) {
      if (error instanceof LedgerNotFoundError) {
        throw new BadRequestException('Source ledger account was not found');
      }
      throw error;
    }
  }

  private assertTreasurySplit(proposal: ProposalRecord): void {
    if (
      proposal.proposalType !== 'treasury_split' ||
      proposal.assetId !== TREASURY_SPLIT_ASSET ||
      proposal.chainId !== TREASURY_SPLIT_CHAIN ||
      proposal.recipientCommitment !== TREASURY_SPLIT_COMMITMENT ||
      proposal.authorizedMaxAtomic !== proposal.amountAtomic ||
      proposal.environment !== 'mock' ||
      proposal.agentId !== undefined ||
      proposal.vendorId !== undefined ||
      !new RegExp(
        `^${TREASURY_SPLIT_OPERATION_PREFIX}[0-9a-f]{8}-[0-9a-f-]{27}$`,
      ).test(proposal.operation)
    ) {
      throw new BadRequestException('Proposal is not a Coffer treasury split');
    }
  }
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
