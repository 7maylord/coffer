export const AUTOMATION_STORE = Symbol('AUTOMATION_STORE');
export const CFO_INFERENCE_ADAPTER = Symbol('CFO_INFERENCE_ADAPTER');
export const MOCK_VENDOR_ADAPTER = Symbol('MOCK_VENDOR_ADAPTER');

export const automationErrorCodes = [
  'AUTOMATION_NOT_FOUND',
  'AUTOMATION_INVALID_INPUT',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_RESPONSE_INVALID',
  'AGENT_DISABLED',
  'AGENT_INACTIVE',
  'VENDOR_NOT_ALLOWED',
  'OFFER_INVALID',
  'OFFER_EXPIRED',
  'PURCHASE_DUPLICATE',
  'PURCHASE_BUDGET_EXCEEDED',
  'PURCHASE_NOT_EXECUTABLE',
] as const;

export type AutomationErrorCode = (typeof automationErrorCodes)[number];

export class AutomationError extends Error {
  constructor(
    readonly code: AutomationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

export type ScopedFinancialRecord = {
  id: string;
  kind: 'invoice';
  assetId: string;
  amountAtomic: string;
  status: string;
};

export type CfoInferenceInput = {
  assetId: string;
  maximumAmountAtomic: string;
  allowedCategories: string[];
  records: ScopedFinancialRecord[];
};

export type CfoInferenceResult = {
  provider: string;
  model: string;
  providerRequestId?: string;
  attestationStatus: 'NOT_REQUESTED' | 'VERIFIED_PROVIDER_TEE';
  output: unknown;
};

export interface CfoInferenceAdapter {
  readonly provider: string;
  readonly model: string;
  infer(input: CfoInferenceInput): Promise<CfoInferenceResult>;
}

export type ValidatedCfoAllocation = {
  category: string;
  amountAtomic: string;
  reason: string;
  supportingRecordIds: string[];
  confidenceBps: number;
  uncertainty: string;
};

export type CfoProposalView = {
  id: string;
  organizationId: string;
  inferenceRunId: string;
  sourceAccountId: string;
  reservationId: string | null;
  assetId: string;
  maximumAmountAtomic: string;
  allocations: ValidatedCfoAllocation[];
  supportingRecordIds: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  provider: string;
  model: string;
  attestationStatus: string;
  inputClassification: string;
  promptTemplateVersion: string;
  responseValidationStatus: 'VALIDATED';
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export type AgentView = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  purpose: string;
  provider: string;
  status: 'ACTIVE' | 'REVOKED';
  allowedActions: string[];
  assetId: string;
  chainId: string;
  maxAmountAtomic: string;
  rollingBudgetAtomic: string;
  rollingWindowSeconds: number;
  vendorAllowlist: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  version: number;
};

export type VendorOffer = {
  vendorId: string;
  externalOfferId: string;
  serviceCode: string;
  requestDigest: string;
  assetId: string;
  chainId: string;
  priceAtomic: string;
  recipientCommitment: string;
  expiresAt: string;
  controlledTerms: {
    documentCount: number;
    classificationProfile: 'standard' | 'financial';
    deliverable: 'classification-labels';
  };
  untrustedText?: string;
};

export type ServiceOfferView = Omit<
  VendorOffer,
  'expiresAt' | 'untrustedText'
> & {
  id: string;
  organizationId: string;
  agentId: string;
  offerDigest: string;
  expiresAt: Date;
};

export interface MockVendorAdapter {
  requestOffer(input: {
    requestDigest: string;
    documentCount: number;
    classificationProfile: 'standard' | 'financial';
    now: Date;
  }): Promise<VendorOffer>;
  fulfill(offer: ServiceOfferView): Promise<{
    mockPaymentReference: string;
    deliverable: {
      serviceCode: 'document-classification';
      processedDocuments: number;
      labels: string[];
    };
  }>;
}

export type PurchaseView = {
  id: string;
  organizationId: string;
  agentId: string;
  offerId: string;
  financialProposalId: string | null;
  status: 'CLAIMED' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'DENIED' | 'FAILED';
  requestDigest: string;
  failureCode: string | null;
  mockPaymentReference: string | null;
  deliverable: Record<string, unknown> | null;
  completedAt: Date | null;
  version: number;
};

export interface AutomationStore {
  scopedInvoiceRecords(
    organizationId: string,
    recordIds: string[],
  ): Promise<ScopedFinancialRecord[]>;
  recordInferenceFailure(input: {
    organizationId: string;
    actorUserId: string;
    provider: string;
    model: string;
    inputDigest: string;
    responseDigest?: string;
    providerRequestId?: string;
    attestationStatus: string;
    status: 'INVALID' | 'FAILED';
    errorCode: string;
  }): Promise<void>;
  createCfoProposal(input: {
    organizationId: string;
    actorUserId: string;
    provider: string;
    model: string;
    inputDigest: string;
    responseDigest: string;
    providerRequestId?: string;
    attestationStatus: string;
    sourceAccountId: string;
    assetId: string;
    maximumAmountAtomic: string;
    allocations: ValidatedCfoAllocation[];
    supportingRecordIds: string[];
  }): Promise<CfoProposalView>;
  cfoProposal(
    organizationId: string,
    proposalId: string,
  ): Promise<CfoProposalView | null>;
  cfoProposals(organizationId: string): Promise<CfoProposalView[]>;
  decideCfoProposal(input: {
    organizationId: string;
    proposalId: string;
    actorUserId: string;
    decision: 'APPROVED' | 'REJECTED';
    decisionNote?: string;
    reservationId?: string;
    now: Date;
  }): Promise<CfoProposalView>;
  createAgent(input: {
    organizationId: string;
    ownerUserId: string;
    purpose: string;
    allowedActions: string[];
    assetId: string;
    chainId: string;
    maxAmountAtomic: string;
    rollingBudgetAtomic: string;
    rollingWindowSeconds: number;
    vendorAllowlist: string[];
    expiresAt: Date;
  }): Promise<AgentView>;
  agents(organizationId: string): Promise<AgentView[]>;
  agent(organizationId: string, agentId: string): Promise<AgentView | null>;
  revokeAgent(
    organizationId: string,
    agentId: string,
    now: Date,
  ): Promise<AgentView | null>;
  createOffer(input: {
    organizationId: string;
    agentId: string;
    offer: VendorOffer;
    offerDigest: string;
  }): Promise<ServiceOfferView>;
  offer(
    organizationId: string,
    offerId: string,
  ): Promise<ServiceOfferView | null>;
  offers(organizationId: string): Promise<ServiceOfferView[]>;
  claimPurchase(input: {
    organizationId: string;
    agentId: string;
    offerId: string;
    requestDigest: string;
    now: Date;
  }): Promise<PurchaseView>;
  attachFinancialProposal(input: {
    organizationId: string;
    purchaseId: string;
    financialProposalId: string;
  }): Promise<PurchaseView>;
  failPurchase(input: {
    organizationId: string;
    purchaseId: string;
    failureCode: string;
    denied: boolean;
  }): Promise<void>;
  purchase(
    organizationId: string,
    purchaseId: string,
  ): Promise<PurchaseView | null>;
  purchases(organizationId: string): Promise<PurchaseView[]>;
  completePurchase(input: {
    organizationId: string;
    purchaseId: string;
    mockPaymentReference: string;
    deliverable: Record<string, unknown>;
    now: Date;
  }): Promise<PurchaseView>;
  onModuleDestroy?(): Promise<void>;
}
