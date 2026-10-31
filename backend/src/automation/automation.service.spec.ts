import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { parseEnvironment } from '../config/env.js';
import type { PolicyService } from '../policy/policy.service.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import type { LedgerService } from '../treasury/ledger.service.js';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';
import {
  AutomationError,
  type AutomationStore,
  type CfoInferenceAdapter,
  type MockVendorAdapter,
  type ServiceOfferView,
} from './automation.types.js';
import {
  MOCK_SERVICE_CODE,
  MOCK_VENDOR_ID,
  MOCK_VENDOR_RECIPIENT_COMMITMENT,
  SeededMockVendorAdapter,
} from './mock-vendor.adapter.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';
const offerId = '66666666-6666-4666-8666-666666666666';
const purchaseId = '77777777-7777-4777-8777-777777777777';
const financialProposalId = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-10-30T12:00:00.000Z');

const cfoRequest = {
  sourceAccountId: accountId,
  assetId: 'mock:base:usdc',
  maximumAmountAtomic: '1000000',
  allowedCategories: ['Operations'],
  supportingRecordIds: [invoiceId],
};
const validOutput = {
  allocations: [
    {
      category: 'Operations',
      amountAtomic: '1000000',
      reason: 'Supported by the selected invoice',
      supportingRecordIds: [invoiceId],
      confidenceBps: 7000,
      uncertainty: 'Forecast timing may change',
    },
  ],
  summary: 'Allocate the approved maximum',
};

function inference(output: unknown = validOutput): CfoInferenceAdapter {
  return {
    provider: 'fixture-ai',
    model: 'fixture/model',
    infer: vi.fn().mockResolvedValue({
      provider: 'fixture-ai',
      model: 'fixture/model',
      attestationStatus: 'UNVERIFIED',
      output,
    }),
  };
}

function store(overrides: Partial<AutomationStore> = {}) {
  return {
    scopedInvoiceRecords: vi.fn().mockResolvedValue([
      {
        id: invoiceId,
        kind: 'invoice',
        assetId: 'mock:base:usdc',
        amountAtomic: '1000000',
        status: 'ISSUED',
      },
    ]),
    recordInferenceFailure: vi.fn().mockResolvedValue(undefined),
    createCfoProposal: vi.fn().mockImplementation(async (input) => ({
      id: '99999999-9999-4999-8999-999999999999',
      organizationId,
      inferenceRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceAccountId: input.sourceAccountId,
      reservationId: null,
      assetId: input.assetId,
      maximumAmountAtomic: input.maximumAmountAtomic,
      allocations: input.allocations,
      supportingRecordIds: input.supportingRecordIds,
      status: 'PENDING',
      provider: input.provider,
      model: input.model,
      attestationStatus: input.attestationStatus,
      inputClassification: 'INTERNAL_FINANCIAL_METADATA',
      promptTemplateVersion: 'cfo-allocation-v1',
      responseValidationStatus: 'VALIDATED',
      decisionNote: null,
      decidedAt: null,
      createdAt: now,
    })),
    cfoProposal: vi.fn().mockResolvedValue(null),
    cfoProposals: vi.fn().mockResolvedValue([]),
    decideCfoProposal: vi.fn(),
    createAgent: vi.fn(),
    agents: vi.fn().mockResolvedValue([]),
    agent: vi.fn().mockResolvedValue(null),
    revokeAgent: vi.fn().mockResolvedValue(null),
    createOffer: vi.fn(),
    offer: vi.fn().mockResolvedValue(null),
    offers: vi.fn().mockResolvedValue([]),
    claimPurchase: vi.fn(),
    attachFinancialProposal: vi.fn(),
    failPurchase: vi.fn().mockResolvedValue(undefined),
    purchase: vi.fn().mockResolvedValue(null),
    purchases: vi.fn().mockResolvedValue([]),
    completePurchase: vi.fn(),
    ...overrides,
  } as unknown as AutomationStore;
}

function fixture(
  options: {
    store?: AutomationStore;
    inference?: CfoInferenceAdapter;
    vendor?: MockVendorAdapter;
    agentExecution?: boolean;
  } = {},
) {
  const automationStore = options.store ?? store();
  const ledger = {
    reserve: vi.fn().mockResolvedValue({
      reservation: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      created: true,
    }),
  } as unknown as LedgerService;
  const policies = {
    create: vi.fn().mockResolvedValue({ id: financialProposalId }),
    get: vi.fn().mockResolvedValue(null),
    activeOrNull: vi.fn().mockResolvedValue(null),
    activate: vi.fn().mockResolvedValue({ id: financialProposalId }),
    approve: vi.fn().mockResolvedValue({ id: financialProposalId }),
    verifyForExecution: vi.fn().mockResolvedValue({ executable: true }),
  } as unknown as PolicyService;
  const service = new AutomationService(
    automationStore,
    options.inference ?? inference(),
    options.vendor ?? new SeededMockVendorAdapter(),
    ledger,
    policies,
    new AssetRegistry(),
    parseEnvironment({
      FEATURE_AGENT_EXECUTION: options.agentExecution ? 'true' : 'false',
    }),
  );
  return { service, store: automationStore, ledger, policies };
}

describe('AutomationService CFO proposals', () => {
  it('lists scoped proposals with truthful provider and attestation capability state', async () => {
    const proposals = [{ id: invoiceId }];
    const test = fixture({
      store: store({ cfoProposals: vi.fn().mockResolvedValue(proposals) }),
    });
    await expect(test.service.cfoWorkspace(organizationId)).resolves.toEqual({
      providerMode: 'mock',
      nearAiEnabled: false,
      attestationVerification: 'not-implemented',
      proposals,
    });
  });

  it('T-AI-04 flags omitted attestation without granting financial authority', async () => {
    const test = fixture();
    await expect(
      test.service.createCfoProposal(organizationId, actorUserId, cfoRequest),
    ).resolves.toMatchObject({
      status: 'PENDING',
      attestationStatus: 'UNVERIFIED',
      responseValidationStatus: 'VALIDATED',
    });
    expect(test.store.createCfoProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        actorUserId,
        sourceAccountId: accountId,
        maximumAmountAtomic: '1000000',
      }),
    );
  });

  it.each([
    ['direct transfer tool', { ...validOutput, transfer: { amount: '1' } }],
    ['malformed JSON shape', { allocations: 'pay-now' }],
    [
      'changed account number',
      {
        ...validOutput,
        allocations: [
          {
            ...validOutput.allocations[0],
            destinationAccount: 'attacker.near',
          },
        ],
      },
    ],
    [
      'amount over the deterministic maximum',
      {
        ...validOutput,
        allocations: [
          { ...validOutput.allocations[0], amountAtomic: '1000001' },
        ],
      },
    ],
    [
      'missing evidence',
      {
        ...validOutput,
        allocations: [
          { ...validOutput.allocations[0], supportingRecordIds: [] },
        ],
      },
    ],
  ])(
    'T-AI-01/T-AI-02/T-AI-05 rejects %s without touching the ledger',
    async (_label, output) => {
      const test = fixture({ inference: inference(output) });
      await expect(
        test.service.createCfoProposal(organizationId, actorUserId, cfoRequest),
      ).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
      expect(test.store.recordInferenceFailure).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'INVALID' }),
      );
      expect(test.ledger.reserve).not.toHaveBeenCalled();
      expect(test.policies.create).not.toHaveBeenCalled();
    },
  );

  it('T-AI-03 records a provider timeout and leaves all financial state untouched', async () => {
    const failed = inference();
    vi.mocked(failed.infer).mockRejectedValue(new Error('timeout'));
    const test = fixture({ inference: failed });
    await expect(
      test.service.createCfoProposal(organizationId, actorUserId, cfoRequest),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(test.store.recordInferenceFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        attestationStatus: 'UNAVAILABLE',
      }),
    );
    expect(test.store.createCfoProposal).not.toHaveBeenCalled();
  });

  it('rejects missing or cross-asset supporting records before inference', async () => {
    const ai = inference();
    const test = fixture({
      inference: ai,
      store: store({
        scopedInvoiceRecords: vi.fn().mockResolvedValue([
          {
            id: invoiceId,
            kind: 'invoice',
            assetId: 'near:testnet:native',
            amountAtomic: '1000000',
            status: 'ISSUED',
          },
        ]),
      }),
    });
    await expect(
      test.service.createCfoProposal(organizationId, actorUserId, cfoRequest),
    ).rejects.toMatchObject({ code: 'AUTOMATION_INVALID_INPUT' });
    expect(ai.infer).not.toHaveBeenCalled();
  });

  it('returns not found for an unknown tenant-scoped CFO proposal', async () => {
    const test = fixture();
    await expect(
      test.service.cfoProposal(organizationId, invoiceId),
    ).rejects.toMatchObject({ code: 'AUTOMATION_NOT_FOUND' });
  });

  it('requires a human approval before creating an idempotent reservation', async () => {
    const proposal = {
      ...(await fixture().service.createCfoProposal(
        organizationId,
        actorUserId,
        cfoRequest,
      )),
      id: '99999999-9999-4999-8999-999999999999',
    };
    const automationStore = store({
      cfoProposal: vi.fn().mockResolvedValue(proposal),
      decideCfoProposal: vi.fn().mockImplementation(async (input) => ({
        ...proposal,
        status: input.decision,
        reservationId: input.reservationId ?? null,
      })),
    });
    const test = fixture({ store: automationStore });
    await expect(
      test.service.decideCfoProposal(
        organizationId,
        proposal.id,
        actorUserId,
        'APPROVED',
        undefined,
        now,
      ),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    expect(test.ledger.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: `cfo:${proposal.id}`,
        amountAtomic: '1000000',
      }),
    );
  });

  it('rejects without reserving and treats a repeated identical decision as idempotent', async () => {
    const proposal = {
      ...(await fixture().service.createCfoProposal(
        organizationId,
        actorUserId,
        cfoRequest,
      )),
      status: 'PENDING' as const,
    };
    const rejected = { ...proposal, status: 'REJECTED' as const };
    const automationStore = store({
      cfoProposal: vi
        .fn()
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce(rejected),
      decideCfoProposal: vi.fn().mockResolvedValue(rejected),
    });
    const test = fixture({ store: automationStore });
    await expect(
      test.service.decideCfoProposal(
        organizationId,
        proposal.id,
        actorUserId,
        'REJECTED',
        'Outside plan',
        now,
      ),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    await expect(
      test.service.decideCfoProposal(
        organizationId,
        proposal.id,
        actorUserId,
        'REJECTED',
        undefined,
        now,
      ),
    ).resolves.toBe(rejected);
    expect(test.ledger.reserve).not.toHaveBeenCalled();
    expect(automationStore.decideCfoProposal).toHaveBeenCalledTimes(1);
  });

  it('blocks changing an existing human decision', async () => {
    const proposal = {
      ...(await fixture().service.createCfoProposal(
        organizationId,
        actorUserId,
        cfoRequest,
      )),
      status: 'REJECTED' as const,
    };
    const test = fixture({
      store: store({ cfoProposal: vi.fn().mockResolvedValue(proposal) }),
    });
    await expect(
      test.service.decideCfoProposal(
        organizationId,
        proposal.id,
        actorUserId,
        'APPROVED',
        undefined,
        now,
      ),
    ).rejects.toMatchObject({ code: 'AUTOMATION_INVALID_INPUT' });
    expect(test.ledger.reserve).not.toHaveBeenCalled();
  });
});

const activeAgent = {
  id: agentId,
  organizationId,
  ownerUserId: actorUserId,
  purpose: 'Classify documents',
  provider: 'coffer-bounded-agent-v1',
  status: 'ACTIVE' as const,
  allowedActions: ['purchase:document-classification'],
  assetId: 'mock:base:usdc',
  chainId: 'mock:base',
  maxAmountAtomic: '2000000',
  rollingBudgetAtomic: '5000000',
  rollingWindowSeconds: 86_400,
  vendorAllowlist: [MOCK_VENDOR_ID],
  expiresAt: new Date(now.getTime() + 60 * 60_000),
  revokedAt: null,
  version: 1,
};

function validOffer(
  overrides: Partial<ServiceOfferView> = {},
): ServiceOfferView {
  const controlled = {
    vendorId: MOCK_VENDOR_ID,
    externalOfferId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    serviceCode: MOCK_SERVICE_CODE,
    requestDigest: '1'.repeat(64),
    assetId: 'mock:base:usdc',
    chainId: 'mock:base',
    priceAtomic: '1000000',
    recipientCommitment: MOCK_VENDOR_RECIPIENT_COMMITMENT,
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    controlledTerms: {
      documentCount: 10,
      classificationProfile: 'standard' as const,
      deliverable: 'classification-labels' as const,
    },
  };
  return {
    id: offerId,
    organizationId,
    agentId,
    ...controlled,
    offerDigest: hash(controlled),
    expiresAt: new Date(controlled.expiresAt),
    ...overrides,
  };
}

describe('AutomationService agent commerce', () => {
  it('lists tenant-scoped commerce evidence and enriches purchases with policy state', async () => {
    const purchase = {
      id: purchaseId,
      organizationId,
      agentId,
      offerId,
      financialProposalId,
      status: 'AWAITING_APPROVAL' as const,
      requestDigest: '2'.repeat(64),
      failureCode: null,
      mockPaymentReference: null,
      deliverable: null,
      completedAt: null,
      version: 2,
    };
    const test = fixture({
      store: store({
        agents: vi.fn().mockResolvedValue([activeAgent]),
        offers: vi.fn().mockResolvedValue([validOffer()]),
        purchases: vi.fn().mockResolvedValue([purchase]),
      }),
    });
    vi.mocked(test.policies.get).mockResolvedValue({
      id: financialProposalId,
      status: 'PENDING',
    } as never);
    await expect(
      test.service.agentWorkspace(organizationId),
    ).resolves.toMatchObject({
      executionEnabled: false,
      settlementMode: 'mock',
      vendor: { untrustedTextUsedForAuthorization: false },
      agents: [activeAgent],
      purchases: [
        {
          id: purchaseId,
          financialProposal: { id: financialProposalId, status: 'PENDING' },
        },
      ],
    });
  });

  it('merges exact agent bounds into a versioned central policy', async () => {
    const test = fixture({
      store: store({ agent: vi.fn().mockResolvedValue(activeAgent) }),
    });
    vi.mocked(test.policies.activeOrNull).mockResolvedValue({
      id: '99999999-9999-4999-8999-999999999999',
      organizationId,
      version: 3,
      digest: 'a'.repeat(64),
      rules: {
        assetLimits: {},
        allowedChainIds: ['internal:ledger'],
        allowedRecipientCommitments: ['b'.repeat(64)],
        rollingWindowSeconds: 60,
        approvalThreshold: 2,
        agentCapsAtomic: {},
        vendorCapsAtomic: {},
        expiresAt: activeAgent.expiresAt.toISOString(),
        frozen: false,
      },
    });

    await test.service.activateAgentPolicy(
      organizationId,
      actorUserId,
      agentId,
      now,
    );

    expect(test.policies.activate).toHaveBeenCalledWith(
      actorUserId,
      organizationId,
      expect.objectContaining({
        assetLimits: {
          'mock:base:usdc': {
            perTransactionCapAtomic: activeAgent.maxAmountAtomic,
            rollingWindowCapAtomic: activeAgent.rollingBudgetAtomic,
            approvalRequiredAboveAtomic: '0',
          },
        },
        allowedChainIds: ['internal:ledger', 'mock:base'],
        allowedRecipientCommitments: [
          'b'.repeat(64),
          MOCK_VENDOR_RECIPIENT_COMMITMENT,
        ],
        agentCapsAtomic: { [agentId]: activeAgent.maxAmountAtomic },
        vendorCapsAtomic: {
          [MOCK_VENDOR_ID]: activeAgent.maxAmountAtomic,
        },
        approvalThreshold: 2,
      }),
    );
  });

  it('routes a verified session wallet approval to the exact purchase proposal', async () => {
    const purchase = {
      id: purchaseId,
      organizationId,
      agentId,
      offerId,
      financialProposalId,
      status: 'AWAITING_APPROVAL' as const,
      requestDigest: '2'.repeat(64),
      failureCode: null,
      mockPaymentReference: null,
      deliverable: null,
      completedAt: null,
      version: 2,
    };
    const test = fixture({
      store: store({ purchase: vi.fn().mockResolvedValue(purchase) }),
    });
    const principal = {
      sessionId: 'session',
      userId: actorUserId,
      expiresAt: activeAgent.expiresAt,
      wallets: [{ network: 'testnet', accountId: 'owner.testnet' }],
      memberships: [{ organizationId, role: 'OWNER' }],
    };

    await test.service.approvePurchase(
      principal,
      organizationId,
      purchaseId,
      'owner.testnet',
    );

    expect(test.policies.approve).toHaveBeenCalledWith(
      principal,
      organizationId,
      financialProposalId,
      'owner.testnet',
    );
  });

  it('creates an expiring agent with an explicit rolling spend window', async () => {
    const automationStore = store({
      createAgent: vi.fn().mockResolvedValue(activeAgent),
    });
    const test = fixture({ store: automationStore });
    await expect(
      test.service.createAgent(
        organizationId,
        actorUserId,
        {
          purpose: 'Classify documents',
          allowedActions: ['purchase:document-classification'],
          assetId: 'mock:base:usdc',
          chainId: 'mock:base',
          maxAmountAtomic: '2000000',
          rollingBudgetAtomic: '5000000',
          rollingWindowSeconds: 3600,
          vendorAllowlist: [MOCK_VENDOR_ID],
          expiresAt: activeAgent.expiresAt.toISOString(),
        },
        now,
      ),
    ).resolves.toBe(activeAgent);
    expect(automationStore.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ rollingWindowSeconds: 3600 }),
    );
  });

  it('fails closed while agent execution is disabled', async () => {
    const test = fixture({
      store: store({
        agent: vi.fn().mockResolvedValue(activeAgent),
        offer: vi.fn().mockResolvedValue(validOffer()),
      }),
    });
    await expect(
      test.service.createPurchaseProposal(
        organizationId,
        actorUserId,
        agentId,
        offerId,
        now,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_DISABLED' });
    expect(test.store.claimPurchase).not.toHaveBeenCalled();
  });

  it.each([
    ['substituted vendor', { vendorId: 'attacker-vendor' }],
    ['changed allowed amount', { priceAtomic: '2000001' }],
  ])(
    'T-AGT-01/T-AGT-04 rejects a vendor-controlled %s',
    async (_label, changed) => {
      const seeded = new SeededMockVendorAdapter();
      const vendor: MockVendorAdapter = {
        ...seeded,
        requestOffer: vi.fn().mockImplementation(async (input) => ({
          ...(await seeded.requestOffer(input)),
          ...changed,
        })),
        fulfill: seeded.fulfill.bind(seeded),
      };
      const test = fixture({
        store: store({ agent: vi.fn().mockResolvedValue(activeAgent) }),
        vendor,
      });
      await expect(
        test.service.requestOffer(
          organizationId,
          agentId,
          {
            serviceCode: 'document-classification',
            documentCount: 10,
            classificationProfile: 'standard',
          },
          now,
        ),
      ).rejects.toMatchObject({ code: 'OFFER_INVALID' });
    },
  );

  it('stores only the controlled fields from a valid seeded vendor offer', async () => {
    const created = validOffer();
    const automationStore = store({
      agent: vi.fn().mockResolvedValue(activeAgent),
      createOffer: vi.fn().mockResolvedValue(created),
    });
    const test = fixture({ store: automationStore });
    await expect(
      test.service.requestOffer(
        organizationId,
        agentId,
        {
          serviceCode: 'document-classification',
          documentCount: 10,
          classificationProfile: 'standard',
        },
        now,
      ),
    ).resolves.toBe(created);
    expect(automationStore.createOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        agentId,
        offerDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        offer: expect.not.objectContaining({
          untrustedText: expect.anything(),
        }),
      }),
    );
  });

  it('blocks an agent whose action or vendor allowlist is missing', async () => {
    const test = fixture({
      store: store({
        agent: vi.fn().mockResolvedValue({
          ...activeAgent,
          allowedActions: [],
          vendorAllowlist: [],
        }),
      }),
    });
    await expect(
      test.service.requestOffer(
        organizationId,
        agentId,
        {
          serviceCode: 'document-classification',
          documentCount: 1,
          classificationProfile: 'standard',
        },
        now,
      ),
    ).rejects.toMatchObject({ code: 'VENDOR_NOT_ALLOWED' });
  });

  it('T-AGT-02 rejects arbitrary vendor URLs at the HTTP validation boundary', async () => {
    const requestOffer = vi.fn();
    const controller = new AutomationController({
      requestOffer,
    } as unknown as AutomationService);
    await expect(
      controller.requestOffer(organizationId, agentId, {
        serviceCode: 'document-classification',
        documentCount: 1,
        classificationProfile: 'standard',
        url: 'http://169.254.169.254/latest/meta-data',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requestOffer).not.toHaveBeenCalled();
  });

  it('T-AGT-03 blocks expired offers before central policy proposal creation', async () => {
    const offer = validOffer({ expiresAt: new Date(now.getTime() - 1) });
    const test = fixture({
      agentExecution: true,
      store: store({
        agent: vi.fn().mockResolvedValue(activeAgent),
        offer: vi.fn().mockResolvedValue(offer),
      }),
    });
    await expect(
      test.service.createPurchaseProposal(
        organizationId,
        actorUserId,
        agentId,
        offerId,
        now,
      ),
    ).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    expect(test.policies.create).not.toHaveBeenCalled();
  });

  it('binds the exact immutable offer to the central policy proposal', async () => {
    const offer = validOffer();
    const purchase = {
      id: purchaseId,
      organizationId,
      agentId,
      offerId,
      financialProposalId: null,
      status: 'CLAIMED' as const,
      requestDigest: '2'.repeat(64),
      failureCode: null,
      mockPaymentReference: null,
      deliverable: null,
      completedAt: null,
      version: 1,
    };
    const automationStore = store({
      agent: vi.fn().mockResolvedValue(activeAgent),
      offer: vi.fn().mockResolvedValue(offer),
      claimPurchase: vi.fn().mockResolvedValue(purchase),
      attachFinancialProposal: vi.fn().mockResolvedValue({
        ...purchase,
        status: 'AWAITING_APPROVAL',
        financialProposalId,
      }),
    });
    const test = fixture({ store: automationStore, agentExecution: true });
    await expect(
      test.service.createPurchaseProposal(
        organizationId,
        actorUserId,
        agentId,
        offerId,
        now,
      ),
    ).resolves.toMatchObject({ status: 'AWAITING_APPROVAL' });
    expect(test.policies.create).toHaveBeenCalledWith(
      actorUserId,
      organizationId,
      expect.objectContaining({
        proposalType: 'AGENT_PURCHASE',
        amountAtomic: offer.priceAtomic,
        authorizedMaxAtomic: activeAgent.maxAmountAtomic,
        recipientCommitment: offer.recipientCommitment,
        agentId,
        vendorId: MOCK_VENDOR_ID,
      }),
      now,
    );
  });

  it('records a denied purchase when central policy rejects it', async () => {
    const purchase = {
      id: purchaseId,
      organizationId,
      agentId,
      offerId,
      financialProposalId: null,
      status: 'CLAIMED' as const,
      requestDigest: '2'.repeat(64),
      failureCode: null,
      mockPaymentReference: null,
      deliverable: null,
      completedAt: null,
      version: 1,
    };
    const automationStore = store({
      agent: vi.fn().mockResolvedValue(activeAgent),
      offer: vi.fn().mockResolvedValue(validOffer()),
      claimPurchase: vi.fn().mockResolvedValue(purchase),
    });
    const test = fixture({ store: automationStore, agentExecution: true });
    vi.mocked(test.policies.create).mockRejectedValue(
      new ForbiddenException('policy denied'),
    );
    await expect(
      test.service.createPurchaseProposal(
        organizationId,
        actorUserId,
        agentId,
        offerId,
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(automationStore.failPurchase).toHaveBeenCalledWith({
      organizationId,
      purchaseId,
      failureCode: 'POLICY_DENIED',
      denied: true,
    });
  });

  it('revalidates policy and the exact offer before mock fulfillment', async () => {
    const offer = validOffer();
    const purchase = {
      id: purchaseId,
      organizationId,
      agentId,
      offerId,
      financialProposalId,
      status: 'AWAITING_APPROVAL' as const,
      requestDigest: '2'.repeat(64),
      failureCode: null,
      mockPaymentReference: null,
      deliverable: null,
      completedAt: null,
      version: 2,
    };
    const completed = {
      ...purchase,
      status: 'COMPLETED' as const,
      mockPaymentReference: 'mock-payment-1',
      deliverable: { labels: ['financial'] },
      completedAt: now,
      version: 3,
    };
    const automationStore = store({
      purchase: vi.fn().mockResolvedValue(purchase),
      agent: vi.fn().mockResolvedValue(activeAgent),
      offer: vi.fn().mockResolvedValue(offer),
      completePurchase: vi.fn().mockResolvedValue(completed),
    });
    const vendor = new SeededMockVendorAdapter();
    const fulfill = vi.spyOn(vendor, 'fulfill');
    const test = fixture({
      store: automationStore,
      vendor,
      agentExecution: true,
    });
    await expect(
      test.service.executePurchase(organizationId, purchaseId, now),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(test.policies.verifyForExecution).toHaveBeenCalledWith(
      organizationId,
      financialProposalId,
      now,
    );
    expect(fulfill).toHaveBeenCalledWith(offer);
  });

  it('T-AGT-05 blocks a duplicate purchase before creating another policy proposal', async () => {
    const automationStore = store({
      agent: vi.fn().mockResolvedValue(activeAgent),
      offer: vi.fn().mockResolvedValue(validOffer()),
      claimPurchase: vi
        .fn()
        .mockRejectedValue(
          new AutomationError('PURCHASE_DUPLICATE', 'duplicate'),
        ),
    });
    const test = fixture({ store: automationStore, agentExecution: true });
    await expect(
      test.service.createPurchaseProposal(
        organizationId,
        actorUserId,
        agentId,
        offerId,
        now,
      ),
    ).rejects.toMatchObject({ code: 'PURCHASE_DUPLICATE' });
    expect(test.policies.create).not.toHaveBeenCalled();
  });

  it('T-AGT-06 immediately blocks revoked agents from offers and execution', async () => {
    const revoked = {
      ...activeAgent,
      status: 'REVOKED' as const,
      revokedAt: now,
    };
    const test = fixture({
      agentExecution: true,
      store: store({ agent: vi.fn().mockResolvedValue(revoked) }),
    });
    await expect(
      test.service.requestOffer(
        organizationId,
        agentId,
        {
          serviceCode: 'document-classification',
          documentCount: 1,
          classificationProfile: 'standard',
        },
        now,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_INACTIVE' });
  });
});

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex');
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
