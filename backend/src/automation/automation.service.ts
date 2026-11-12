import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { PolicyService } from '../policy/policy.service.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import { LedgerService } from '../treasury/ledger.service.js';
import { parseAtomicAmount } from '../treasury/money.js';
import {
  AUTOMATION_STORE,
  AutomationError,
  CFO_INFERENCE_ADAPTER,
  type AutomationStore,
  type CfoInferenceAdapter,
  type CfoInferenceInput,
  MOCK_VENDOR_ADAPTER,
  type MockVendorAdapter,
  type ServiceOfferView,
  type ValidatedCfoAllocation,
} from './automation.types.js';
import {
  MOCK_SERVICE_CODE,
  MOCK_VENDOR_ID,
  MOCK_VENDOR_RECIPIENT_COMMITMENT,
} from './mock-vendor.adapter.js';

const atomic = z.string().regex(/^[1-9][0-9]{0,77}$/);
const category = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/);
const cfoOutputSchema = z
  .object({
    allocations: z
      .array(
        z
          .object({
            category,
            amountAtomic: atomic,
            reason: z.string().trim().min(1).max(500),
            supportingRecordIds: z.array(z.string().uuid()).min(1).max(50),
            confidenceBps: z.number().int().min(0).max(10_000),
            uncertainty: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();
const vendorOfferSchema = z
  .object({
    vendorId: z.literal(MOCK_VENDOR_ID),
    externalOfferId: z.string().uuid(),
    serviceCode: z.literal(MOCK_SERVICE_CODE),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    assetId: z.literal('mock:base:usdc'),
    chainId: z.literal('mock:base'),
    priceAtomic: atomic,
    recipientCommitment: z.literal(MOCK_VENDOR_RECIPIENT_COMMITMENT),
    expiresAt: z.string().datetime({ offset: true }),
    controlledTerms: z
      .object({
        documentCount: z.number().int().min(1).max(100),
        classificationProfile: z.enum(['standard', 'financial']),
        deliverable: z.literal('classification-labels'),
      })
      .strict(),
    untrustedText: z.string().max(2_000).optional(),
  })
  .strict();

@Injectable()
export class AutomationService {
  constructor(
    @Inject(AUTOMATION_STORE) private readonly store: AutomationStore,
    @Inject(CFO_INFERENCE_ADAPTER)
    private readonly inference: CfoInferenceAdapter,
    @Inject(MOCK_VENDOR_ADAPTER) private readonly vendor: MockVendorAdapter,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(AssetRegistry) private readonly assets: AssetRegistry,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async createCfoProposal(
    organizationId: string,
    actorUserId: string,
    input: {
      sourceAccountId: string;
      assetId: string;
      maximumAmountAtomic: string;
      allowedCategories: string[];
      supportingRecordIds: string[];
    },
  ) {
    const normalized = normalizeCfoInput(input);
    this.assets.require(normalized.assetId);
    const records = await this.store.scopedInvoiceRecords(
      organizationId,
      normalized.supportingRecordIds,
    );
    if (
      records.length !== normalized.supportingRecordIds.length ||
      records.some((record) => record.assetId !== normalized.assetId)
    ) {
      throw new AutomationError(
        'AUTOMATION_INVALID_INPUT',
        'Supporting records are missing, cross-tenant, or use another asset',
      );
    }
    const scopedInput: CfoInferenceInput = {
      assetId: normalized.assetId,
      maximumAmountAtomic: normalized.maximumAmountAtomic,
      allowedCategories: normalized.allowedCategories,
      records,
    };
    const inputDigest = digest(scopedInput);
    let result: Awaited<ReturnType<CfoInferenceAdapter['infer']>>;
    try {
      result = await this.inference.infer(scopedInput);
    } catch {
      await this.store.recordInferenceFailure({
        organizationId,
        actorUserId,
        provider: this.inference.provider,
        model: this.inference.model,
        inputDigest,
        attestationStatus: 'UNAVAILABLE',
        status: 'FAILED',
        errorCode: 'PROVIDER_UNAVAILABLE',
      });
      throw new AutomationError(
        'AI_PROVIDER_UNAVAILABLE',
        'CFO inference provider failed',
      );
    }
    const responseDigest = safeDigest(result.output);
    const parsed = cfoOutputSchema.safeParse(result.output);
    if (
      !parsed.success ||
      !validAllocations(
        parsed.success ? parsed.data.allocations : [],
        normalized.allowedCategories,
        normalized.supportingRecordIds,
        normalized.maximumAmountAtomic,
      )
    ) {
      await this.store.recordInferenceFailure({
        organizationId,
        actorUserId,
        provider: result.provider,
        model: result.model,
        inputDigest,
        responseDigest,
        providerRequestId: result.providerRequestId,
        attestationStatus: result.attestationStatus,
        status: 'INVALID',
        errorCode: 'SCHEMA_OR_BOUNDS_INVALID',
      });
      throw new AutomationError(
        'AI_RESPONSE_INVALID',
        'CFO output failed schema, evidence, category, or amount validation',
      );
    }
    return this.store.createCfoProposal({
      organizationId,
      actorUserId,
      provider: result.provider,
      model: result.model,
      inputDigest,
      responseDigest,
      providerRequestId: result.providerRequestId,
      attestationStatus: result.attestationStatus,
      sourceAccountId: normalized.sourceAccountId,
      assetId: normalized.assetId,
      maximumAmountAtomic: normalized.maximumAmountAtomic,
      allocations: parsed.data.allocations,
      supportingRecordIds: normalized.supportingRecordIds,
    });
  }

  async cfoProposal(organizationId: string, proposalId: string) {
    const proposal = await this.store.cfoProposal(organizationId, proposalId);
    if (!proposal) throw notFound('CFO proposal');
    return proposal;
  }

  async cfoWorkspace(organizationId: string) {
    return {
      providerMode: this.environment.AI_CFO_PROVIDER,
      nearAiEnabled: this.environment.NEAR_AI_CFO_ENABLED,
      attestationVerification:
        this.environment.AI_CFO_PROVIDER === 'near-ai'
          ? ('provider-tee' as const)
          : ('not-requested' as const),
      proposals: await this.store.cfoProposals(organizationId),
    };
  }

  async decideCfoProposal(
    organizationId: string,
    proposalId: string,
    actorUserId: string,
    decision: 'APPROVED' | 'REJECTED',
    decisionNote?: string,
    now = new Date(),
  ) {
    const proposal = await this.cfoProposal(organizationId, proposalId);
    if (proposal.status !== 'PENDING') {
      if (proposal.status === decision) return proposal;
      throw new AutomationError(
        'AUTOMATION_INVALID_INPUT',
        'CFO proposal already has a decision',
      );
    }
    if (decision === 'REJECTED') {
      return this.store.decideCfoProposal({
        organizationId,
        proposalId,
        actorUserId,
        decision,
        decisionNote,
        now,
      });
    }
    const { reservation } = await this.ledger.reserve({
      organizationId,
      assetId: proposal.assetId,
      accountId: proposal.sourceAccountId,
      reference: `cfo:${proposal.id}`,
      amountAtomic: proposal.maximumAmountAtomic,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    });
    return this.store.decideCfoProposal({
      organizationId,
      proposalId,
      actorUserId,
      decision,
      decisionNote,
      reservationId: reservation.id,
      now,
    });
  }

  createAgent(
    organizationId: string,
    ownerUserId: string,
    input: {
      purpose: string;
      allowedActions: string[];
      assetId: string;
      chainId: string;
      maxAmountAtomic: string;
      rollingBudgetAtomic: string;
      rollingWindowSeconds?: number;
      vendorAllowlist: string[];
      expiresAt: string;
    },
    now = new Date(),
  ) {
    const value = normalizeAgentInput(input, now);
    this.assets.require(value.assetId);
    return this.store.createAgent({
      organizationId,
      ownerUserId,
      ...value,
    });
  }

  agents(organizationId: string) {
    return this.store.agents(organizationId);
  }

  async agentWorkspace(organizationId: string) {
    const [agents, offers, purchases] = await Promise.all([
      this.store.agents(organizationId),
      this.store.offers(organizationId),
      this.store.purchases(organizationId),
    ]);
    const withProposals = await Promise.all(
      purchases.map(async (purchase) => ({
        ...purchase,
        financialProposal: purchase.financialProposalId
          ? await this.policies.get(
              organizationId,
              purchase.financialProposalId,
            )
          : null,
      })),
    );
    return {
      executionEnabled: this.environment.FEATURE_AGENT_EXECUTION,
      settlementMode: 'mock' as const,
      vendor: {
        id: MOCK_VENDOR_ID,
        serviceCode: MOCK_SERVICE_CODE,
        recipientCommitment: MOCK_VENDOR_RECIPIENT_COMMITMENT,
        untrustedTextUsedForAuthorization: false,
      },
      agents,
      offers,
      purchases: withProposals,
    };
  }

  async activateAgentPolicy(
    organizationId: string,
    actorUserId: string,
    agentId: string,
    now = new Date(),
  ) {
    const [agent, active] = await Promise.all([
      this.requireActiveAgent(organizationId, agentId, now),
      this.policies.activeOrNull(organizationId),
    ]);
    const currentLimit = active?.rules.assetLimits[agent.assetId];
    const maximum = (left: string | undefined, right: string) =>
      left && BigInt(left) > BigInt(right) ? left : right;
    const expiresAt = active
      ? new Date(
          Math.min(
            Date.parse(active.rules.expiresAt),
            agent.expiresAt.getTime(),
          ),
        )
      : agent.expiresAt;
    return this.policies.activate(actorUserId, organizationId, {
      assetLimits: {
        ...active?.rules.assetLimits,
        [agent.assetId]: {
          perTransactionCapAtomic: maximum(
            currentLimit?.perTransactionCapAtomic,
            agent.maxAmountAtomic,
          ),
          rollingWindowCapAtomic: maximum(
            currentLimit?.rollingWindowCapAtomic,
            agent.rollingBudgetAtomic,
          ),
          approvalRequiredAboveAtomic: '0',
        },
      },
      allowedChainIds: [
        ...new Set([...(active?.rules.allowedChainIds ?? []), agent.chainId]),
      ],
      allowedRecipientCommitments: [
        ...new Set([
          ...(active?.rules.allowedRecipientCommitments ?? []),
          MOCK_VENDOR_RECIPIENT_COMMITMENT,
        ]),
      ],
      rollingWindowSeconds: Math.max(
        active?.rules.rollingWindowSeconds ?? 60,
        agent.rollingWindowSeconds,
      ),
      approvalThreshold: Math.max(active?.rules.approvalThreshold ?? 2, 2),
      agentCapsAtomic: {
        ...active?.rules.agentCapsAtomic,
        [agent.id]: agent.maxAmountAtomic,
      },
      vendorCapsAtomic: {
        ...active?.rules.vendorCapsAtomic,
        [MOCK_VENDOR_ID]: agent.maxAmountAtomic,
      },
      expiresAt: expiresAt.toISOString(),
      frozen: active?.rules.frozen ?? false,
    });
  }

  async revokeAgent(organizationId: string, agentId: string, now = new Date()) {
    const agent = await this.store.revokeAgent(organizationId, agentId, now);
    if (!agent) throw notFound('Agent');
    return agent;
  }

  async requestOffer(
    organizationId: string,
    agentId: string,
    input: {
      serviceCode: 'document-classification';
      documentCount: number;
      classificationProfile: 'standard' | 'financial';
    },
    now = new Date(),
  ) {
    const agent = await this.requireActiveAgent(organizationId, agentId, now);
    if (
      !agent.allowedActions.includes('purchase:document-classification') ||
      !agent.vendorAllowlist.includes(MOCK_VENDOR_ID)
    ) {
      throw new AutomationError(
        'VENDOR_NOT_ALLOWED',
        'Agent is not permitted to use the seeded vendor',
      );
    }
    const request = {
      serviceCode: input.serviceCode,
      documentCount: input.documentCount,
      classificationProfile: input.classificationProfile,
    };
    const requestDigest = digest(request);
    const untrusted = await this.vendor.requestOffer({
      requestDigest,
      documentCount: input.documentCount,
      classificationProfile: input.classificationProfile,
      now,
    });
    const parsed = vendorOfferSchema.safeParse(untrusted);
    if (!parsed.success) throw invalidOffer();
    const offer = parsed.data;
    const expiresAt = new Date(offer.expiresAt);
    if (
      offer.requestDigest !== requestDigest ||
      offer.assetId !== agent.assetId ||
      offer.chainId !== agent.chainId ||
      BigInt(offer.priceAtomic) > BigInt(agent.maxAmountAtomic) ||
      expiresAt <= now ||
      expiresAt.getTime() > now.getTime() + 60 * 60_000 ||
      offer.controlledTerms.documentCount !== input.documentCount ||
      offer.controlledTerms.classificationProfile !==
        input.classificationProfile
    ) {
      throw invalidOffer();
    }
    const controlled = {
      vendorId: offer.vendorId,
      externalOfferId: offer.externalOfferId,
      serviceCode: offer.serviceCode,
      requestDigest: offer.requestDigest,
      assetId: offer.assetId,
      chainId: offer.chainId,
      priceAtomic: offer.priceAtomic,
      recipientCommitment: offer.recipientCommitment,
      expiresAt: offer.expiresAt,
      controlledTerms: offer.controlledTerms,
    };
    return this.store.createOffer({
      organizationId,
      agentId,
      offer: controlled,
      offerDigest: digest(controlled),
    });
  }

  async createPurchaseProposal(
    organizationId: string,
    actorUserId: string,
    agentId: string,
    offerId: string,
    now = new Date(),
  ) {
    this.assertAgentExecutionEnabled();
    const [agent, offer] = await Promise.all([
      this.requireActiveAgent(organizationId, agentId, now),
      this.requireOffer(organizationId, offerId),
    ]);
    verifyOfferForAgent(offer, agentId, agent, now);
    const requestDigest = digest({
      operation: 'agent-purchase-proposal',
      organizationId,
      agentId,
      offerDigest: offer.offerDigest,
    });
    const purchase = await this.store.claimPurchase({
      organizationId,
      agentId,
      offerId,
      requestDigest,
      now,
    });
    try {
      const proposal = await this.policies.create(
        actorUserId,
        organizationId,
        {
          proposalType: 'AGENT_PURCHASE',
          chainId: offer.chainId,
          assetId: offer.assetId,
          amountAtomic: offer.priceAtomic,
          authorizedMaxAtomic: agent.maxAmountAtomic,
          recipientCommitment: offer.recipientCommitment,
          expiresAt: offer.expiresAt,
          nonceCommitment: digest({ offerId: offer.externalOfferId }),
          idempotencyKeyCommitment: digest({
            agentId,
            offerDigest: offer.offerDigest,
          }),
          operation: 'AGENT_SERVICE_PURCHASE',
          environment: 'mock',
          agentId,
          vendorId: offer.vendorId,
        },
        now,
      );
      return this.store.attachFinancialProposal({
        organizationId,
        purchaseId: purchase.id,
        financialProposalId: proposal.id,
      });
    } catch (error) {
      await this.store.failPurchase({
        organizationId,
        purchaseId: purchase.id,
        failureCode:
          error instanceof ForbiddenException
            ? 'POLICY_DENIED'
            : 'POLICY_CREATION_FAILED',
        denied: error instanceof ForbiddenException,
      });
      throw error;
    }
  }

  async purchase(organizationId: string, purchaseId: string) {
    const purchase = await this.store.purchase(organizationId, purchaseId);
    if (!purchase) throw notFound('Purchase');
    return purchase;
  }

  async approvePurchase(
    principal: SessionPrincipal,
    organizationId: string,
    purchaseId: string,
    nearAccountId: string,
  ) {
    const purchase = await this.purchase(organizationId, purchaseId);
    if (
      purchase.status !== 'AWAITING_APPROVAL' ||
      !purchase.financialProposalId
    ) {
      throw new AutomationError(
        'PURCHASE_NOT_EXECUTABLE',
        'Purchase has no pending financial proposal',
      );
    }
    return this.policies.approve(
      principal,
      organizationId,
      purchase.financialProposalId,
      nearAccountId,
    );
  }

  async executePurchase(
    organizationId: string,
    purchaseId: string,
    now = new Date(),
  ) {
    this.assertAgentExecutionEnabled();
    const purchase = await this.purchase(organizationId, purchaseId);
    if (
      purchase.status !== 'AWAITING_APPROVAL' ||
      !purchase.financialProposalId
    ) {
      throw new AutomationError(
        'PURCHASE_NOT_EXECUTABLE',
        'Purchase has no executable financial proposal',
      );
    }
    const [agent, offer] = await Promise.all([
      this.requireActiveAgent(organizationId, purchase.agentId, now),
      this.requireOffer(organizationId, purchase.offerId),
    ]);
    verifyOfferForAgent(offer, purchase.agentId, agent, now);
    await this.policies.verifyForExecution(
      organizationId,
      purchase.financialProposalId,
      now,
    );
    const fulfilled = await this.vendor.fulfill(offer);
    return this.store.completePurchase({
      organizationId,
      purchaseId,
      mockPaymentReference: fulfilled.mockPaymentReference,
      deliverable: fulfilled.deliverable,
      now,
    });
  }

  private async requireActiveAgent(
    organizationId: string,
    agentId: string,
    now: Date,
  ) {
    const agent = await this.store.agent(organizationId, agentId);
    if (!agent) throw notFound('Agent');
    if (
      agent.status !== 'ACTIVE' ||
      agent.revokedAt ||
      agent.expiresAt <= now
    ) {
      throw new AutomationError('AGENT_INACTIVE', 'Agent is inactive');
    }
    return agent;
  }

  private async requireOffer(organizationId: string, offerId: string) {
    const offer = await this.store.offer(organizationId, offerId);
    if (!offer) throw notFound('Offer');
    return offer;
  }

  private assertAgentExecutionEnabled(): void {
    if (!this.environment.FEATURE_AGENT_EXECUTION) {
      throw new AutomationError(
        'AGENT_DISABLED',
        'Agent purchase execution is disabled',
      );
    }
  }
}

function normalizeCfoInput(input: {
  sourceAccountId: string;
  assetId: string;
  maximumAmountAtomic: string;
  allowedCategories: string[];
  supportingRecordIds: string[];
}) {
  const parsed = z
    .object({
      sourceAccountId: z.string().uuid(),
      assetId: z.string().min(1).max(192),
      maximumAmountAtomic: atomic,
      allowedCategories: z.array(category).min(1).max(20),
      supportingRecordIds: z.array(z.string().uuid()).min(1).max(50),
    })
    .strict()
    .safeParse(input);
  if (
    !parsed.success ||
    new Set(parsed.data.allowedCategories).size !==
      parsed.data.allowedCategories.length ||
    new Set(parsed.data.supportingRecordIds).size !==
      parsed.data.supportingRecordIds.length
  ) {
    throw new AutomationError(
      'AUTOMATION_INVALID_INPUT',
      'CFO request is invalid',
    );
  }
  return {
    ...parsed.data,
    maximumAmountAtomic: parseAtomicAmount(
      parsed.data.maximumAmountAtomic,
    ).toString(),
    allowedCategories: [...parsed.data.allowedCategories].sort(),
    supportingRecordIds: [...parsed.data.supportingRecordIds].sort(),
  };
}

function validAllocations(
  allocations: ValidatedCfoAllocation[],
  categories: string[],
  records: string[],
  maximumAmountAtomic: string,
): boolean {
  if (
    new Set(allocations.map(({ category }) => category)).size !==
    allocations.length
  )
    return false;
  const allowedCategories = new Set(categories);
  const allowedRecords = new Set(records);
  let total = 0n;
  for (const allocation of allocations) {
    if (
      !allowedCategories.has(allocation.category) ||
      new Set(allocation.supportingRecordIds).size !==
        allocation.supportingRecordIds.length ||
      allocation.supportingRecordIds.some((id) => !allowedRecords.has(id))
    ) {
      return false;
    }
    total += BigInt(allocation.amountAtomic);
  }
  return total === BigInt(maximumAmountAtomic);
}

function normalizeAgentInput(
  input: {
    purpose: string;
    allowedActions: string[];
    assetId: string;
    chainId: string;
    maxAmountAtomic: string;
    rollingBudgetAtomic: string;
    rollingWindowSeconds?: number;
    vendorAllowlist: string[];
    expiresAt: string;
  },
  now: Date,
) {
  const parsed = z
    .object({
      purpose: z.string().trim().min(1).max(200),
      allowedActions: z
        .array(z.literal('purchase:document-classification'))
        .length(1),
      assetId: z.literal('mock:base:usdc'),
      chainId: z.literal('mock:base'),
      maxAmountAtomic: atomic,
      rollingBudgetAtomic: atomic,
      rollingWindowSeconds: z
        .number()
        .int()
        .min(60)
        .max(31_536_000)
        .default(86_400),
      vendorAllowlist: z.array(z.literal(MOCK_VENDOR_ID)).length(1),
      expiresAt: z.string().datetime({ offset: true }),
    })
    .strict()
    .safeParse(input);
  if (
    !parsed.success ||
    BigInt(parsed.data.maxAmountAtomic) >
      BigInt(parsed.data.rollingBudgetAtomic) ||
    new Date(parsed.data.expiresAt) <= now
  ) {
    throw new AutomationError(
      'AUTOMATION_INVALID_INPUT',
      'Agent bounds or allowlist are invalid',
    );
  }
  return {
    ...parsed.data,
    maxAmountAtomic: parseAtomicAmount(parsed.data.maxAmountAtomic).toString(),
    rollingBudgetAtomic: parseAtomicAmount(
      parsed.data.rollingBudgetAtomic,
    ).toString(),
    expiresAt: new Date(parsed.data.expiresAt),
  };
}

function verifyOfferForAgent(
  offer: ServiceOfferView,
  agentId: string,
  agent: {
    assetId: string;
    chainId: string;
    maxAmountAtomic: string;
    vendorAllowlist: string[];
  },
  now: Date,
): void {
  const controlled = {
    vendorId: offer.vendorId,
    externalOfferId: offer.externalOfferId,
    serviceCode: offer.serviceCode,
    requestDigest: offer.requestDigest,
    assetId: offer.assetId,
    chainId: offer.chainId,
    priceAtomic: offer.priceAtomic,
    recipientCommitment: offer.recipientCommitment,
    expiresAt: offer.expiresAt.toISOString(),
    controlledTerms: offer.controlledTerms,
  };
  if (
    offer.agentId !== agentId ||
    offer.offerDigest !== digest(controlled) ||
    offer.expiresAt <= now ||
    offer.vendorId !== MOCK_VENDOR_ID ||
    !agent.vendorAllowlist.includes(offer.vendorId) ||
    offer.assetId !== agent.assetId ||
    offer.chainId !== agent.chainId ||
    BigInt(offer.priceAtomic) > BigInt(agent.maxAmountAtomic)
  ) {
    throw new AutomationError(
      offer.expiresAt <= now ? 'OFFER_EXPIRED' : 'OFFER_INVALID',
      'Offer no longer matches the approved agent bounds',
    );
  }
}

function invalidOffer() {
  return new AutomationError(
    'OFFER_INVALID',
    'Vendor offer failed identity, request, price, or expiry validation',
  );
}

function notFound(entity: string) {
  return new AutomationError('AUTOMATION_NOT_FOUND', `${entity} was not found`);
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex');
}

function safeDigest(value: unknown): string {
  try {
    return digest(value);
  } catch {
    return createHash('sha256').update('unserializable-output').digest('hex');
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
