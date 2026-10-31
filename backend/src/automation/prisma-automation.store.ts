import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  AgentPurchaseStatus,
  CfoProposalStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  AutomationError,
  type AutomationStore,
  type CfoProposalView,
  type AgentView,
  type PurchaseView,
  type ServiceOfferView,
  type ValidatedCfoAllocation,
  type VendorOffer,
} from './automation.types.js';

@Injectable()
export class PrismaAutomationStore implements AutomationStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async scopedInvoiceRecords(organizationId: string, recordIds: string[]) {
    const records = await this.prisma.invoice.findMany({
      where: { organizationId, id: { in: recordIds } },
      select: {
        id: true,
        currency: true,
        totalAmountAtomic: true,
        status: true,
      },
      orderBy: { id: 'asc' },
    });
    return records.map((record) => ({
      id: record.id,
      kind: 'invoice' as const,
      assetId: record.currency,
      amountAtomic: record.totalAmountAtomic.toFixed(0),
      status: record.status,
    }));
  }

  async recordInferenceFailure(
    input: Parameters<AutomationStore['recordInferenceFailure']>[0],
  ) {
    await this.prisma.cfoInferenceRun.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        provider: input.provider,
        model: input.model,
        inputClassification: 'INTERNAL_FINANCIAL_METADATA',
        promptTemplateVersion: 'cfo-allocation-v1',
        inputDigest: input.inputDigest,
        responseDigest: input.responseDigest,
        providerRequestId: input.providerRequestId,
        attestationStatus: input.attestationStatus,
        status: input.status,
        errorCode: input.errorCode,
      },
    });
  }

  async createCfoProposal(
    input: Parameters<AutomationStore['createCfoProposal']>[0],
  ) {
    const proposalId = await this.prisma.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.findFirst({
        where: {
          id: input.sourceAccountId,
          organizationId: input.organizationId,
          assetId: input.assetId,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!account) {
        throw new AutomationError(
          'AUTOMATION_INVALID_INPUT',
          'Source account does not match the organization and asset',
        );
      }
      const run = await tx.cfoInferenceRun.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          provider: input.provider,
          model: input.model,
          inputClassification: 'INTERNAL_FINANCIAL_METADATA',
          promptTemplateVersion: 'cfo-allocation-v1',
          inputDigest: input.inputDigest,
          responseDigest: input.responseDigest,
          providerRequestId: input.providerRequestId,
          attestationStatus: input.attestationStatus,
          status: 'VALIDATED',
        },
      });
      const proposal = await tx.cfoAllocationProposal.create({
        data: {
          organizationId: input.organizationId,
          inferenceRunId: run.id,
          createdByUserId: input.actorUserId,
          sourceAccountId: input.sourceAccountId,
          assetId: input.assetId,
          maximumAmountAtomic: new Prisma.Decimal(input.maximumAmountAtomic),
          allocations: input.allocations as unknown as Prisma.InputJsonValue,
          supportingRecordIds:
            input.supportingRecordIds as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return proposal.id;
    });
    return this.requireCfo(input.organizationId, proposalId);
  }

  cfoProposal(organizationId: string, proposalId: string) {
    return this.readCfo(organizationId, proposalId);
  }

  async cfoProposals(organizationId: string) {
    return (
      await this.prisma.cfoAllocationProposal.findMany({
        where: { organizationId },
        include: { inferenceRun: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map(mapCfo);
  }

  async decideCfoProposal(
    input: Parameters<AutomationStore['decideCfoProposal']>[0],
  ) {
    const changed = await this.prisma.cfoAllocationProposal.updateMany({
      where: {
        id: input.proposalId,
        organizationId: input.organizationId,
        status: CfoProposalStatus.PENDING,
      },
      data: {
        status: input.decision,
        decidedByUserId: input.actorUserId,
        decisionNote: input.decisionNote,
        reservationId: input.reservationId,
        decidedAt: input.now,
        version: { increment: 1 },
      },
    });
    const proposal = await this.requireCfo(
      input.organizationId,
      input.proposalId,
    );
    if (changed.count === 0 && proposal.status !== input.decision) {
      throw new AutomationError(
        'AUTOMATION_INVALID_INPUT',
        'CFO proposal already has a different decision',
      );
    }
    return proposal;
  }

  async createAgent(input: Parameters<AutomationStore['createAgent']>[0]) {
    const agent = await this.prisma.agentIdentity.create({
      data: {
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        purpose: input.purpose,
        provider: 'coffer-bounded-agent-v1',
        allowedActions: input.allowedActions,
        assetId: input.assetId,
        chainId: input.chainId,
        maxAmountAtomic: new Prisma.Decimal(input.maxAmountAtomic),
        rollingBudgetAtomic: new Prisma.Decimal(input.rollingBudgetAtomic),
        rollingWindowSeconds: input.rollingWindowSeconds,
        vendorAllowlist: input.vendorAllowlist,
        expiresAt: input.expiresAt,
      },
    });
    return mapAgent(agent);
  }

  async agents(organizationId: string) {
    return (
      await this.prisma.agentIdentity.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      })
    ).map(mapAgent);
  }

  async agent(organizationId: string, agentId: string) {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, organizationId },
    });
    return agent ? mapAgent(agent) : null;
  }

  async revokeAgent(organizationId: string, agentId: string, now: Date) {
    await this.prisma.agentIdentity.updateMany({
      where: { id: agentId, organizationId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: now, version: { increment: 1 } },
    });
    return this.agent(organizationId, agentId);
  }

  async createOffer(input: Parameters<AutomationStore['createOffer']>[0]) {
    try {
      const offer = await this.prisma.serviceOffer.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          vendorId: input.offer.vendorId,
          externalOfferId: input.offer.externalOfferId,
          serviceCode: input.offer.serviceCode,
          requestDigest: input.offer.requestDigest,
          offerDigest: input.offerDigest,
          assetId: input.offer.assetId,
          chainId: input.offer.chainId,
          priceAtomic: new Prisma.Decimal(input.offer.priceAtomic),
          recipientCommitment: input.offer.recipientCommitment,
          controlledTerms: input.offer
            .controlledTerms as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(input.offer.expiresAt),
        },
      });
      return mapOffer(offer);
    } catch (error) {
      if (known(error, 'P2002')) {
        throw new AutomationError('OFFER_INVALID', 'Duplicate vendor offer');
      }
      throw error;
    }
  }

  async offer(organizationId: string, offerId: string) {
    const offer = await this.prisma.serviceOffer.findFirst({
      where: { id: offerId, organizationId },
    });
    return offer ? mapOffer(offer) : null;
  }

  async offers(organizationId: string) {
    return (
      await this.prisma.serviceOffer.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map(mapOffer);
  }

  async claimPurchase(input: Parameters<AutomationStore['claimPurchase']>[0]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "AgentIdentity" WHERE "id" = ${input.agentId}::uuid AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE`;
            const [agent, offer] = await Promise.all([
              tx.agentIdentity.findFirst({
                where: {
                  id: input.agentId,
                  organizationId: input.organizationId,
                },
              }),
              tx.serviceOffer.findFirst({
                where: {
                  id: input.offerId,
                  organizationId: input.organizationId,
                  agentId: input.agentId,
                },
              }),
            ]);
            if (!agent || !offer) {
              throw new AutomationError(
                'AUTOMATION_NOT_FOUND',
                'Agent or offer was not found',
              );
            }
            const existing = await tx.agentPurchase.findUnique({
              where: { offerId: input.offerId },
              select: { id: true },
            });
            if (existing) {
              throw new AutomationError(
                'PURCHASE_DUPLICATE',
                'Offer already has a purchase proposal',
              );
            }
            if (
              agent.status !== 'ACTIVE' ||
              agent.revokedAt ||
              agent.expiresAt <= input.now
            ) {
              throw new AutomationError('AGENT_INACTIVE', 'Agent is inactive');
            }
            if (offer.expiresAt <= input.now) {
              throw new AutomationError('OFFER_EXPIRED', 'Offer expired');
            }
            if (offer.priceAtomic.gt(agent.maxAmountAtomic)) {
              throw new AutomationError(
                'PURCHASE_BUDGET_EXCEEDED',
                'Offer exceeds the per-purchase limit',
              );
            }
            const totals = await tx.$queryRaw<
              Array<{ total: Prisma.Decimal | null }>
            >`SELECT COALESCE(SUM(o."priceAtomic"), 0) AS "total"
              FROM "AgentPurchase" p
              JOIN "ServiceOffer" o ON o."id" = p."offerId"
             WHERE p."agentId" = ${input.agentId}::uuid
               AND p."createdAt" >= ${new Date(
                 input.now.getTime() - agent.rollingWindowSeconds * 1000,
               )}
               AND p."status" IN ('CLAIMED', 'AWAITING_APPROVAL', 'COMPLETED')`;
            const committed = totals[0]?.total ?? new Prisma.Decimal(0);
            if (
              committed.add(offer.priceAtomic).gt(agent.rollingBudgetAtomic)
            ) {
              throw new AutomationError(
                'PURCHASE_BUDGET_EXCEEDED',
                'Offer exceeds the agent rolling budget',
              );
            }
            const purchase = await tx.agentPurchase.create({
              data: {
                organizationId: input.organizationId,
                agentId: input.agentId,
                offerId: input.offerId,
                requestDigest: input.requestDigest,
              },
            });
            return mapPurchase(purchase);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (known(error, 'P2034') && attempt < 2) continue;
        if (known(error, 'P2002')) {
          throw new AutomationError(
            'PURCHASE_DUPLICATE',
            'Offer already has a purchase proposal',
          );
        }
        throw error;
      }
    }
    throw new AutomationError(
      'PURCHASE_NOT_EXECUTABLE',
      'Purchase claim could not be serialized',
    );
  }

  async attachFinancialProposal(
    input: Parameters<AutomationStore['attachFinancialProposal']>[0],
  ) {
    const updated = await this.prisma.agentPurchase.updateMany({
      where: {
        id: input.purchaseId,
        organizationId: input.organizationId,
        status: AgentPurchaseStatus.CLAIMED,
        financialProposalId: null,
      },
      data: {
        financialProposalId: input.financialProposalId,
        status: AgentPurchaseStatus.AWAITING_APPROVAL,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new AutomationError(
        'PURCHASE_NOT_EXECUTABLE',
        'Purchase proposal could not be linked',
      );
    }
    return this.requirePurchase(input.organizationId, input.purchaseId);
  }

  async failPurchase(
    input: Parameters<AutomationStore['failPurchase']>[0],
  ): Promise<void> {
    await this.prisma.agentPurchase.updateMany({
      where: {
        id: input.purchaseId,
        organizationId: input.organizationId,
        status: AgentPurchaseStatus.CLAIMED,
      },
      data: {
        status: input.denied ? 'DENIED' : 'FAILED',
        failureCode: input.failureCode,
        version: { increment: 1 },
      },
    });
  }

  async purchase(organizationId: string, purchaseId: string) {
    const purchase = await this.prisma.agentPurchase.findFirst({
      where: { id: purchaseId, organizationId },
    });
    return purchase ? mapPurchase(purchase) : null;
  }

  async purchases(organizationId: string) {
    return (
      await this.prisma.agentPurchase.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map(mapPurchase);
  }

  async completePurchase(
    input: Parameters<AutomationStore['completePurchase']>[0],
  ) {
    const updated = await this.prisma.agentPurchase.updateMany({
      where: {
        id: input.purchaseId,
        organizationId: input.organizationId,
        status: AgentPurchaseStatus.AWAITING_APPROVAL,
      },
      data: {
        status: AgentPurchaseStatus.COMPLETED,
        mockPaymentReference: input.mockPaymentReference,
        deliverable: input.deliverable as Prisma.InputJsonValue,
        completedAt: input.now,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new AutomationError(
        'PURCHASE_NOT_EXECUTABLE',
        'Purchase is not awaiting an approved policy proposal',
      );
    }
    return this.requirePurchase(input.organizationId, input.purchaseId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async readCfo(organizationId: string, proposalId: string) {
    const proposal = await this.prisma.cfoAllocationProposal.findFirst({
      where: { id: proposalId, organizationId },
      include: { inferenceRun: true },
    });
    return proposal ? mapCfo(proposal) : null;
  }

  private async requireCfo(organizationId: string, proposalId: string) {
    const proposal = await this.readCfo(organizationId, proposalId);
    if (!proposal) {
      throw new AutomationError(
        'AUTOMATION_NOT_FOUND',
        'CFO proposal was not found',
      );
    }
    return proposal;
  }

  private async requirePurchase(organizationId: string, purchaseId: string) {
    const purchase = await this.purchase(organizationId, purchaseId);
    if (!purchase) {
      throw new AutomationError(
        'AUTOMATION_NOT_FOUND',
        'Purchase was not found',
      );
    }
    return purchase;
  }
}

function mapCfo(
  value: Prisma.CfoAllocationProposalGetPayload<{
    include: { inferenceRun: true };
  }>,
): CfoProposalView {
  return {
    id: value.id,
    organizationId: value.organizationId,
    inferenceRunId: value.inferenceRunId,
    sourceAccountId: value.sourceAccountId,
    reservationId: value.reservationId,
    assetId: value.assetId,
    maximumAmountAtomic: value.maximumAmountAtomic.toFixed(0),
    allocations: value.allocations as unknown as ValidatedCfoAllocation[],
    supportingRecordIds: value.supportingRecordIds as string[],
    status: value.status,
    provider: value.inferenceRun.provider,
    model: value.inferenceRun.model,
    attestationStatus: value.inferenceRun.attestationStatus,
    inputClassification: value.inferenceRun.inputClassification,
    promptTemplateVersion: value.inferenceRun.promptTemplateVersion,
    responseValidationStatus: 'VALIDATED',
    decisionNote: value.decisionNote,
    decidedAt: value.decidedAt,
    createdAt: value.createdAt,
  };
}

function mapAgent(value: {
  id: string;
  organizationId: string;
  ownerUserId: string;
  purpose: string;
  provider: string;
  status: 'ACTIVE' | 'REVOKED';
  allowedActions: Prisma.JsonValue;
  assetId: string;
  chainId: string;
  maxAmountAtomic: Prisma.Decimal;
  rollingBudgetAtomic: Prisma.Decimal;
  rollingWindowSeconds: number;
  vendorAllowlist: Prisma.JsonValue;
  expiresAt: Date;
  revokedAt: Date | null;
  version: number;
}): AgentView {
  return {
    ...value,
    allowedActions: value.allowedActions as string[],
    maxAmountAtomic: value.maxAmountAtomic.toFixed(0),
    rollingBudgetAtomic: value.rollingBudgetAtomic.toFixed(0),
    vendorAllowlist: value.vendorAllowlist as string[],
  };
}

function mapOffer(value: {
  id: string;
  organizationId: string;
  agentId: string;
  vendorId: string;
  externalOfferId: string;
  serviceCode: string;
  requestDigest: string;
  offerDigest: string;
  assetId: string;
  chainId: string;
  priceAtomic: Prisma.Decimal;
  recipientCommitment: string;
  controlledTerms: Prisma.JsonValue;
  expiresAt: Date;
}): ServiceOfferView {
  return {
    ...value,
    serviceCode: value.serviceCode,
    priceAtomic: value.priceAtomic.toFixed(0),
    controlledTerms: value.controlledTerms as VendorOffer['controlledTerms'],
  };
}

function mapPurchase(value: {
  id: string;
  organizationId: string;
  agentId: string;
  offerId: string;
  financialProposalId: string | null;
  status: PurchaseView['status'];
  requestDigest: string;
  failureCode: string | null;
  mockPaymentReference: string | null;
  deliverable: Prisma.JsonValue | null;
  completedAt: Date | null;
  version: number;
}): PurchaseView {
  return {
    ...value,
    deliverable: value.deliverable as Record<string, unknown> | null,
  };
}

function known(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
