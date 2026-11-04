import { z } from "zod";
import type { operations } from "@/lib/api-schema";

export type AuthChallenge =
  operations["Auth.createNearChallenge"]["responses"][201]["content"]["application/json"];
export type SessionPrincipal =
  operations["Auth.session"]["responses"][200]["content"]["application/json"];
export type VerifyNearInput =
  operations["Auth.verifyNear"]["requestBody"]["content"]["application/json"];
export type Organization =
  operations["Organization.list"]["responses"][200]["content"]["application/json"][number];
export type CreateOrganizationInput =
  operations["Organization.create"]["requestBody"]["content"]["application/json"];
export type OrganizationRole = Organization["role"];
export type Invoice =
  operations["Invoice.list"]["responses"][200]["content"]["application/json"][number];
export type CreateInvoiceInput =
  operations["Invoice.create"]["requestBody"]["content"]["application/json"];
export type CreatedInvoice =
  operations["Invoice.create"]["responses"][201]["content"]["application/json"];
export type PublicInvoice =
  operations["PublicInvoice.getInvoice"]["responses"][200]["content"]["application/json"];
export type SettlementAssets =
  operations["PublicInvoice.supportedAssets"]["responses"][200]["content"]["application/json"];
export type PublicQuoteInput =
  operations["PublicInvoice.createQuote"]["requestBody"]["content"]["application/json"];
export type PublicQuote =
  operations["PublicInvoice.createQuote"]["responses"][201]["content"]["application/json"];
export type PublicPayment =
  operations["PublicInvoice.initiate"]["responses"][201]["content"]["application/json"];
export type TreasuryWorkspace =
  operations["TreasuryWorkflow.workspace"]["responses"][200]["content"]["application/json"];
export type TreasuryProposal =
  operations["TreasuryWorkflow.create"]["responses"][201]["content"]["application/json"];
export type TreasurySplitInput =
  operations["TreasuryWorkflow.create"]["requestBody"]["content"]["application/json"];
export type TreasuryPolicyInput =
  operations["TreasuryWorkflow.activatePolicy"]["requestBody"]["content"]["application/json"];
export type CfoWorkspace =
  operations["Automation.cfoWorkspace"]["responses"][200]["content"]["application/json"];
export type CfoProposal = CfoWorkspace["proposals"][number];
export type CfoProposalInput =
  operations["Automation.createCfo"]["requestBody"]["content"]["application/json"];
export type AgentWorkspace =
  operations["Automation.agentWorkspace"]["responses"][200]["content"]["application/json"];
export type Agent = AgentWorkspace["agents"][number];
export type AgentInput =
  operations["Automation.createAgent"]["requestBody"]["content"]["application/json"];

const challengeSchema = z
  .object({
    challengeId: z.uuid(),
    network: z.literal("testnet"),
    message: z.string().min(1),
    recipient: z.url(),
    nonce: z.string().min(1),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();

const roleSchema = z.enum([
  "OWNER",
  "FINANCE_ADMIN",
  "APPROVER",
  "AGENT_OPERATOR",
  "EMPLOYEE",
  "AUDITOR",
  "VIEWER",
]);

const sessionSchema = z
  .object({
    sessionId: z.string().min(1),
    userId: z.string().min(1),
    expiresAt: z.iso.datetime(),
    wallets: z.array(
      z
        .object({
          network: z.string().min(1),
          accountId: z.string().min(2),
        })
        .strict(),
    ),
    memberships: z.array(
      z
        .object({
          organizationId: z.string().min(1),
          role: roleSchema,
        })
        .strict(),
    ),
  })
  .strict();

const organizationSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    role: roleSchema,
  })
  .strict();

const verifyResultSchema = z
  .object({ userId: z.string().min(1), expiresAt: z.iso.datetime() })
  .strict();

const revokedSchema = z.object({ status: z.literal("revoked") }).strict();

const invoiceStatusSchema = z.enum([
  "DRAFT",
  "ISSUED",
  "EXPIRED",
  "VOID",
  "PAID",
]);
const paymentStateSchema = z.enum([
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "OVERPAID",
]);
const paymentStatusSchema = z.enum([
  "CREATED",
  "QUOTED",
  "AWAITING_AUTHORIZATION",
  "AWAITING_DEPOSIT",
  "DEPOSIT_OBSERVED",
  "PROCESSING",
  "SETTLED",
  "REFUND_PENDING",
  "REFUNDED",
  "FAILED",
  "EXPIRED",
  "UNDERFUNDED",
  "UNKNOWN_REQUIRES_RECONCILIATION",
]);
const mockScenarioSchema = z.enum([
  "success",
  "refund",
  "unknown",
  "partial_deposit",
  "expired_quote",
  "status_delay",
  "duplicate_callback",
]);
const lineItemSchema = z
  .object({
    description: z.string(),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();
const publicInvoiceSchema = z
  .object({
    invoiceNumber: z.string(),
    status: invoiceStatusSchema,
    paymentState: paymentStateSchema,
    currency: z.string(),
    totalAmountAtomic: z.string().regex(/^\d+$/),
    verifiedReceivedAtomic: z.string().regex(/^\d+$/),
    outstandingAmountAtomic: z.string().regex(/^\d+$/),
    payeeDestination: z.string(),
    lineItems: z.array(lineItemSchema),
    dueDate: z.iso.datetime(),
  })
  .strict();
const invoiceSchema = publicInvoiceSchema
  .extend({
    id: z.uuid(),
    organizationId: z.uuid(),
    customer: z
      .object({ displayName: z.string(), email: z.email().optional() })
      .strict(),
    metadata: z.record(z.string(), z.string()),
    revision: z.number().int(),
    version: z.number().int(),
    createdByUserId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    issuedAt: z.iso.datetime().nullable(),
    expiredAt: z.iso.datetime().nullable(),
    voidedAt: z.iso.datetime().nullable(),
    paidAt: z.iso.datetime().nullable(),
    paymentAttempts: z.array(
      z
        .object({
          id: z.uuid(),
          status: z.string(),
          amountAtomic: z.string().regex(/^\d+$/),
          assetId: z.string(),
          createdAt: z.iso.datetime(),
          settledAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const createdInvoiceSchema = z
  .object({
    invoice: invoiceSchema,
    publicToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
const settlementAssetsSchema = z
  .object({
    mode: z.literal("mock"),
    assets: z.array(
      z
        .object({
          id: z.string(),
          chain: z.string(),
          decimals: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
const publicQuoteSchema = z
  .object({
    id: z.uuid(),
    sourceAssetId: z.string(),
    destinationAssetId: z.string(),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    recipient: z.string(),
    refundTo: z.string(),
    slippageBps: z.number().int(),
    confidentiality: z.enum(["none", "basic", "advanced"]),
    scenario: mockScenarioSchema,
    provider: z.literal("mock"),
    expectedAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const publicPaymentSchema = z
  .object({
    id: z.uuid(),
    quoteId: z.uuid(),
    provider: z.literal("mock"),
    scenario: mockScenarioSchema,
    status: paymentStatusSchema,
    version: z.number().int(),
    settlementPostingCount: z.number().int(),
    refundPostingCount: z.number().int(),
    pollCount: z.number().int(),
    history: z.array(
      z
        .object({
          status: paymentStatusSchema,
          observedAt: z.iso.datetime(),
          eventId: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const treasuryApprovalSchema = z
  .object({
    approverUserId: z.uuid(),
    approverNearAccountId: z.string(),
    approvedInstructionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
  })
  .strict();
const treasuryProposalSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    proposalKey: z.uuid(),
    revision: z.number().int().positive(),
    proposalType: z.literal("treasury_split"),
    status: z.enum([
      "PENDING",
      "APPROVED",
      "CANCELLED",
      "EXPIRED",
      "SUPERSEDED",
      "STALE_POLICY",
    ]),
    policyDefinitionId: z.uuid(),
    policyVersion: z.number().int().positive(),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    organizationCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    proposalIdCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    instructionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    chainId: z.literal("internal:ledger"),
    assetId: z.literal("mock:near:usdc"),
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    authorizedMaxAtomic: z.string().regex(/^[1-9][0-9]*$/),
    recipientCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
    nonceCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKeyCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.string().regex(/^reserve_split:[0-9a-f-]{36}$/),
    environment: z.literal("mock"),
    agentId: z.string().optional(),
    vendorId: z.string().optional(),
    approvalThreshold: z.number().int().min(2),
    createdByUserId: z.uuid(),
    createdAt: z.iso.datetime(),
    approvals: z.array(treasuryApprovalSchema),
  })
  .strict();
const ledgerAccountSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    assetId: z.literal("mock:near:usdc"),
    code: z.string(),
    name: z.string(),
    accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
    normalSide: z.enum(["DEBIT", "CREDIT"]),
    postedBalanceAtomic: z.string().regex(/^\d+$/),
    reservedBalanceAtomic: z.string().regex(/^\d+$/),
    availableBalanceAtomic: z.string().regex(/^\d+$/),
    version: z.number().int(),
  })
  .strict();
const activePolicySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    version: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    rules: z.record(z.string(), z.unknown()),
  })
  .strict();
const splitTemplateSchema = z
  .object({
    shares: z.array(
      z
        .object({
          recipientId: z.string(),
          basisPoints: z.number().int().positive(),
        })
        .strict(),
    ),
    remainderRecipientId: z.literal("payroll"),
    recipientCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const treasuryWorkspaceSchema = z
  .object({
    balanceSource: z.literal("ledger-derived internal"),
    custodyStatus: z.literal("not on-chain verified"),
    asset: z
      .object({
        assetId: z.literal("mock:near:usdc"),
        symbol: z.literal("Mock USDC"),
        decimals: z.literal(6),
        environment: z.literal("mock"),
      })
      .strict(),
    accounts: z.array(ledgerAccountSchema),
    activePolicy: activePolicySchema.nullable(),
    proposals: z.array(treasuryProposalSchema),
    splitTemplate: splitTemplateSchema,
  })
  .strict();
const splitPreviewSchema = z
  .object({
    amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    allocations: z.array(
      z
        .object({
          recipientId: z.string(),
          basisPoints: z.number().int(),
          amountAtomic: z.string().regex(/^\d+$/),
        })
        .strict(),
    ),
    remainderRecipientId: z.literal("payroll"),
    recipientCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const treasuryPolicySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    version: z.number().int(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    rules: z.record(z.string(), z.unknown()),
  })
  .strict();
const reserveResultSchema = z
  .object({
    verification: z
      .object({
        executable: z.literal(true),
        verification: z.enum(["offchain", "contract"]),
        evidence: z
          .object({
            contractAccountId: z.string(),
            network: z.string(),
            blockHash: z.string(),
            blockHeight: z.number().int(),
            codeHash: z.string(),
            configurationVersion: z.number().int(),
            approvalAccounts: z.array(z.string()),
          })
          .strict()
          .optional(),
      })
      .strict(),
    reservation: z.record(z.string(), z.unknown()),
    created: z.boolean(),
    split: splitPreviewSchema,
  })
  .strict();
const cfoProposalSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    inferenceRunId: z.uuid(),
    sourceAccountId: z.uuid(),
    reservationId: z.uuid().nullable(),
    assetId: z.string(),
    maximumAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    allocations: z.array(
      z
        .object({
          category: z.string(),
          amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
          reason: z.string(),
          supportingRecordIds: z.array(z.uuid()),
          confidenceBps: z.number().int().min(0).max(10_000),
          uncertainty: z.string(),
        })
        .strict(),
    ),
    supportingRecordIds: z.array(z.uuid()),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    provider: z.string(),
    model: z.string(),
    attestationStatus: z.string(),
    inputClassification: z.string(),
    promptTemplateVersion: z.string(),
    responseValidationStatus: z.literal("VALIDATED"),
    decisionNote: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const cfoWorkspaceSchema = z
  .object({
    providerMode: z.enum(["mock", "near-ai"]),
    nearAiEnabled: z.boolean(),
    attestationVerification: z.literal("not-implemented"),
    proposals: z.array(cfoProposalSchema),
  })
  .strict();
const agentSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    ownerUserId: z.uuid(),
    purpose: z.string(),
    provider: z.string(),
    status: z.enum(["ACTIVE", "REVOKED"]),
    allowedActions: z.array(z.string()),
    assetId: z.string(),
    chainId: z.string(),
    maxAmountAtomic: z.string().regex(/^[1-9][0-9]*$/),
    rollingBudgetAtomic: z.string().regex(/^[1-9][0-9]*$/),
    rollingWindowSeconds: z.number().int(),
    vendorAllowlist: z.array(z.string()),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    version: z.number().int(),
  })
  .strict();
const offerSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    agentId: z.uuid(),
    vendorId: z.string(),
    externalOfferId: z.uuid(),
    serviceCode: z.string(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    offerDigest: z.string().regex(/^[a-f0-9]{64}$/),
    assetId: z.string(),
    chainId: z.string(),
    priceAtomic: z.string().regex(/^[1-9][0-9]*$/),
    recipientCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    controlledTerms: z
      .object({
        documentCount: z.number().int(),
        classificationProfile: z.enum(["standard", "financial"]),
        deliverable: z.literal("classification-labels"),
      })
      .strict(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const financialProposalSchema = z
  .object({
    id: z.uuid(),
    status: z.enum([
      "PENDING",
      "APPROVED",
      "CANCELLED",
      "EXPIRED",
      "SUPERSEDED",
      "STALE_POLICY",
    ]),
    policyVersion: z.number().int(),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    instructionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
    approvalThreshold: z.number().int().min(2),
    approvals: z.array(treasuryApprovalSchema),
  })
  .loose();
const purchaseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    agentId: z.uuid(),
    offerId: z.uuid(),
    financialProposalId: z.uuid().nullable(),
    status: z.enum([
      "CLAIMED",
      "AWAITING_APPROVAL",
      "COMPLETED",
      "DENIED",
      "FAILED",
    ]),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    failureCode: z.string().nullable(),
    mockPaymentReference: z.string().nullable(),
    deliverable: z.record(z.string(), z.unknown()).nullable(),
    completedAt: z.iso.datetime().nullable(),
    version: z.number().int(),
  })
  .strict();
const purchaseWithProposalSchema = purchaseSchema.extend({
  financialProposal: financialProposalSchema.nullable(),
});
const agentWorkspaceSchema = z
  .object({
    executionEnabled: z.boolean(),
    settlementMode: z.literal("mock"),
    vendor: z
      .object({
        id: z.string(),
        serviceCode: z.string(),
        recipientCommitment: z.string().regex(/^[a-f0-9]{64}$/),
        untrustedTextUsedForAuthorization: z.literal(false),
      })
      .strict(),
    agents: z.array(agentSchema),
    offers: z.array(offerSchema),
    purchases: z.array(purchaseWithProposalSchema),
  })
  .strict();
const payrollStatusSchema = z.enum([
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "PROCESSING",
  "SETTLED",
  "FAILED",
]);
const payrollSummarySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    reference: z.string(),
    status: payrollStatusSchema,
    assetId: z.string(),
    manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    totalGrossAtomic: z.string().regex(/^\d+$/),
    totalNetAtomic: z.string().regex(/^\d+$/),
    lineCount: z.number().int().nonnegative(),
    calculationAssumption: z.literal("SYNTHETIC_NO_TAX"),
    approvedManifestDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    approvedAt: z.iso.datetime().nullable(),
    version: z.number().int().positive(),
    confidentiality: z.string(),
  })
  .strict();
const payrollBatchSchema = payrollSummarySchema
  .extend({
    lines: z.array(
      z
        .object({
          id: z.uuid(),
          employeeCode: z.string(),
          userId: z.uuid().nullable(),
          grossAmountAtomic: z.string().regex(/^\d+$/),
          netAmountAtomic: z.string().regex(/^\d+$/),
          profile: z
            .object({
              legalName: z.string(),
              address: z.string(),
              payoutAccount: z.string(),
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();
const payslipSchema = z
  .object({
    id: z.uuid(),
    batchId: z.uuid(),
    reference: z.string(),
    status: payrollStatusSchema,
    assetId: z.string(),
    employeeCode: z.string(),
    legalName: z.string(),
    address: z.string(),
    payoutAccount: z.string(),
    grossAmountAtomic: z.string().regex(/^\d+$/),
    netAmountAtomic: z.string().regex(/^\d+$/),
    calculationAssumption: z.literal("SYNTHETIC_NO_TAX"),
    confidentiality: z.string(),
  })
  .strict();
const payrollAnalysisSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["deterministic", "private-ai"]),
    findings: z.array(
      z
        .object({
          lineId: z.uuid(),
          code: z.enum([
            "ABOVE_2X_MEDIAN",
            "DUPLICATE_AMOUNT",
            "REVIEW_RECOMMENDED",
          ]),
          severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
          explanation: z.string(),
        })
        .strict(),
    ),
    attestationStatus: z.enum(["NOT_REQUESTED", "VERIFIED_PROVIDER_TEE"]),
    confidentiality: z.string(),
  })
  .strict();
const reconciliationCaseSchema = z
  .object({
    id: z.uuid(),
    reasonCode: z.string(),
    status: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const operationAttemptSchema = z
  .object({
    id: z.uuid(),
    provider: z.string(),
    status: paymentStatusSchema,
    version: z.number().int(),
    pollCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    reconciliationCase: reconciliationCaseSchema.nullable(),
  })
  .strict();
const operationsDashboardSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    stuckThresholdSeconds: z.number().int().positive(),
    queued: z.array(
      z
        .object({
          id: z.uuid(),
          topic: z.string(),
          aggregateId: z.string(),
          attempts: z.number().int(),
          availableAt: z.iso.datetime(),
          lastErrorCode: z.string().nullable(),
          createdAt: z.iso.datetime(),
        })
        .strict(),
    ),
    pending: z.array(operationAttemptSchema),
    stuck: z.array(operationAttemptSchema),
    refunded: z.array(operationAttemptSchema),
    completed: z.array(operationAttemptSchema),
  })
  .strict();
const operationsMetricsSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    paymentsByStatus: z.record(z.string(), z.number().int().nonnegative()),
    queuedOutboxEvents: z.number().int().nonnegative(),
    openReconciliationCases: z.number().int().nonnegative(),
    stalePendingPayments: z.number().int().nonnegative(),
    oldestQueuedAt: z.iso.datetime().nullable(),
  })
  .strict();
const auditPageSchema = z
  .object({
    events: z.array(
      z
        .object({
          id: z.uuid(),
          sequence: z.number().int().positive(),
          actorId: z.uuid().nullable(),
          eventType: z.string(),
          entityType: z.string(),
          entityId: z.string(),
          correlationId: z.string(),
          traceId: z.string().nullable(),
          previousHash: z.string().nullable(),
          eventHash: z.string(),
          metadata: z.record(z.string(), z.unknown()),
          createdAt: z.iso.datetime(),
        })
        .strict(),
    ),
    nextCursor: z.uuid().nullable(),
    integrity: z
      .object({
        verified: z.boolean(),
        eventCount: z.number().int().nonnegative(),
        headHash: z.string().nullable(),
        algorithm: z.literal("SHA-256"),
      })
      .strict(),
  })
  .strict();
const recheckSchema = z
  .object({
    actionId: z.uuid(),
    caseId: z.uuid(),
    paymentId: z.uuid(),
    action: z.literal("RECHECK_EXISTING_PAYMENT"),
    status: z.literal("QUEUED"),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type PayrollSummary = z.infer<typeof payrollSummarySchema>;
export type PayrollBatch = z.infer<typeof payrollBatchSchema>;
export type Payslip = z.infer<typeof payslipSchema>;
export type PayrollAnalysis = z.infer<typeof payrollAnalysisSchema>;
export type OperationsDashboard = z.infer<typeof operationsDashboardSchema>;
export type OperationsMetrics = z.infer<typeof operationsMetricsSchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "INVALID_RESPONSE"
      | "UNAVAILABLE"
      | "CONFLICT"
      | "REQUEST_FAILED",
  ) {
    super(code);
    this.name = "ApiError";
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("coffer_csrf="))
    ?.slice("coffer_csrf=".length);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? decodeURIComponent(value)
    : "";
}

function errorForStatus(status: number): ApiError {
  if (status === 401) return new ApiError(status, "UNAUTHORIZED");
  if (status === 403) return new ApiError(status, "FORBIDDEN");
  if (status === 409) return new ApiError(status, "CONFLICT");
  if (status === 502 || status === 503 || status === 504)
    return new ApiError(status, "UNAVAILABLE");
  return new ApiError(status, "REQUEST_FAILED");
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  useCsrf = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (useCsrf) {
    const token = csrfToken();
    if (!token) throw new ApiError(401, "UNAUTHORIZED");
    headers.set("x-csrf-token", token);
  }

  let response: Response;
  try {
    response = await fetch(`/api/coffer${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "UNAVAILABLE");
  }
  if (!response.ok) throw errorForStatus(response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiError(response.status, "INVALID_RESPONSE");
  return parsed.data;
}

export const cofferApi = {
  createChallenge: () =>
    request("/v1/auth/near/challenge", challengeSchema, { method: "POST" }),
  verifyNear: (input: VerifyNearInput) =>
    request("/v1/auth/near/verify", verifyResultSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  session: () => request("/v1/auth/session", sessionSchema),
  organizations: () =>
    request("/v1/organizations", z.array(organizationSchema)),
  createOrganization: (input: CreateOrganizationInput) =>
    request(
      "/v1/organizations",
      organizationSchema,
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  logout: () =>
    request("/v1/auth/logout", revokedSchema, { method: "POST" }, true),
  invoices: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/invoices`,
      z.array(invoiceSchema),
    ),
  createInvoice: (organizationId: string, input: CreateInvoiceInput) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/invoices`,
      createdInvoiceSchema,
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  updateInvoice: (
    organizationId: string,
    invoiceId: string,
    input: Partial<CreateInvoiceInput>,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}`,
      invoiceSchema,
      { method: "PATCH", body: JSON.stringify(input) },
      true,
    ),
  issueInvoice: (organizationId: string, invoiceId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}/issue`,
      invoiceSchema,
      { method: "POST" },
      true,
    ),
  voidInvoice: (organizationId: string, invoiceId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
      invoiceSchema,
      { method: "POST" },
      true,
    ),
  publicInvoice: (publicToken: string) =>
    request(
      `/v1/public/invoices/${encodeURIComponent(publicToken)}`,
      publicInvoiceSchema,
    ),
  publicSettlementAssets: (publicToken: string) =>
    request(
      `/v1/public/invoices/${encodeURIComponent(publicToken)}/settlement/assets`,
      settlementAssetsSchema,
    ),
  createPublicQuote: (publicToken: string, input: PublicQuoteInput) =>
    request(
      `/v1/public/invoices/${encodeURIComponent(publicToken)}/quotes`,
      publicQuoteSchema,
      { method: "POST", body: JSON.stringify(input) },
    ),
  initiatePublicPayment: (
    publicToken: string,
    quoteId: string,
    idempotencyKey: string,
  ) =>
    request(
      `/v1/public/invoices/${encodeURIComponent(publicToken)}/payments`,
      publicPaymentSchema,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ quoteId }),
      },
    ),
  publicPayment: (publicToken: string, paymentId: string) =>
    request(
      `/v1/public/invoices/${encodeURIComponent(publicToken)}/payments/${encodeURIComponent(paymentId)}`,
      publicPaymentSchema,
    ),
  pollPublicPayment: (publicToken: string, paymentId: string) =>
    request(
      `/v1/public/invoices/${encodeURIComponent(publicToken)}/payments/${encodeURIComponent(paymentId)}/poll`,
      publicPaymentSchema,
      { method: "POST" },
    ),
  treasuryWorkspace: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury`,
      treasuryWorkspaceSchema,
    ),
  activateTreasuryPolicy: (
    organizationId: string,
    input: TreasuryPolicyInput,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/policy`,
      treasuryPolicySchema,
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  previewTreasurySplit: (organizationId: string, amountAtomic: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/split-proposals/preview`,
      splitPreviewSchema,
      { method: "POST", body: JSON.stringify({ amountAtomic }) },
      true,
    ),
  createTreasurySplit: (organizationId: string, input: TreasurySplitInput) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/split-proposals`,
      treasuryProposalSchema,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
      },
      true,
    ),
  reviseTreasurySplit: (
    organizationId: string,
    proposalId: string,
    input: TreasurySplitInput,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/split-proposals/${encodeURIComponent(proposalId)}/revisions`,
      treasuryProposalSchema,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
      },
      true,
    ),
  approveTreasurySplit: (
    organizationId: string,
    proposalId: string,
    nearAccountId: string,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/split-proposals/${encodeURIComponent(proposalId)}/approvals`,
      treasuryProposalSchema,
      { method: "POST", body: JSON.stringify({ nearAccountId }) },
      true,
    ),
  cancelTreasurySplit: (organizationId: string, proposalId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/split-proposals/${encodeURIComponent(proposalId)}/cancel`,
      treasuryProposalSchema,
      { method: "POST" },
      true,
    ),
  reserveTreasurySplit: (organizationId: string, proposalId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/treasury/split-proposals/${encodeURIComponent(proposalId)}/reserve`,
      reserveResultSchema,
      { method: "POST" },
      true,
    ),
  cfoWorkspace: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/ai/cfo/workspace`,
      cfoWorkspaceSchema,
    ),
  createCfoProposal: (organizationId: string, input: CfoProposalInput) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/ai/cfo/proposals`,
      cfoProposalSchema,
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  decideCfoProposal: (
    organizationId: string,
    proposalId: string,
    decision: "APPROVED" | "REJECTED",
    note?: string,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/ai/cfo/proposals/${encodeURIComponent(proposalId)}/decision`,
      cfoProposalSchema,
      {
        method: "POST",
        body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
      },
      true,
    ),
  agentWorkspace: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agent-workspace`,
      agentWorkspaceSchema,
    ),
  createAgent: (organizationId: string, input: AgentInput) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agents`,
      agentSchema,
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  revokeAgent: (organizationId: string, agentId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agents/${encodeURIComponent(agentId)}/revoke`,
      agentSchema,
      { method: "POST" },
      true,
    ),
  activateAgentPolicy: (organizationId: string, agentId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agents/${encodeURIComponent(agentId)}/policy`,
      treasuryPolicySchema,
      { method: "POST" },
      true,
    ),
  requestAgentOffer: (
    organizationId: string,
    agentId: string,
    documentCount: number,
    classificationProfile: "standard" | "financial",
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agents/${encodeURIComponent(agentId)}/offers`,
      offerSchema,
      {
        method: "POST",
        body: JSON.stringify({
          serviceCode: "document-classification",
          documentCount,
          classificationProfile,
        }),
      },
      true,
    ),
  createAgentPurchase: (
    organizationId: string,
    agentId: string,
    offerId: string,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agents/${encodeURIComponent(agentId)}/purchase-proposals`,
      purchaseSchema,
      { method: "POST", body: JSON.stringify({ offerId }) },
      true,
    ),
  approveAgentPurchase: (
    organizationId: string,
    purchaseId: string,
    nearAccountId: string,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agent-purchases/${encodeURIComponent(purchaseId)}/approvals`,
      financialProposalSchema,
      { method: "POST", body: JSON.stringify({ nearAccountId }) },
      true,
    ),
  executeAgentPurchase: (organizationId: string, purchaseId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/agent-purchases/${encodeURIComponent(purchaseId)}/execute`,
      purchaseSchema,
      { method: "POST" },
      true,
    ),
  payrollBatches: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/payroll/batches`,
      z.array(payrollSummarySchema),
    ),
  payrollBatch: (organizationId: string, batchId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/payroll/batches/${encodeURIComponent(batchId)}`,
      payrollBatchSchema,
    ),
  importPayroll: (
    organizationId: string,
    input: {
      reference: string;
      assetId: string;
      synthetic: true;
      perEmployeeCapAtomic: string;
      batchCapAtomic: string;
      csv: string;
    },
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/payroll/imports`,
      payrollSummarySchema,
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  analyzePayroll: (
    organizationId: string,
    batchId: string,
    mode: "deterministic" | "private-ai",
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/payroll/batches/${encodeURIComponent(batchId)}/analysis`,
      payrollAnalysisSchema,
      { method: "POST", body: JSON.stringify({ mode }) },
      true,
    ),
  approvePayroll: (
    organizationId: string,
    batchId: string,
    expectedManifestDigest: string,
    expectedVersion: number,
  ) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/payroll/batches/${encodeURIComponent(batchId)}/approve`,
      payrollSummarySchema,
      {
        method: "POST",
        body: JSON.stringify({ expectedManifestDigest, expectedVersion }),
      },
      true,
    ),
  payslips: () => request("/v1/me/payslips", z.array(payslipSchema)),
  operationsDashboard: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/operations/settlements`,
      operationsDashboardSchema,
    ),
  operationsMetrics: (organizationId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/operations/metrics`,
      operationsMetricsSchema,
    ),
  auditEvents: (
    organizationId: string,
    eventType?: string,
    cursor?: string,
  ) => {
    const query = new URLSearchParams({ limit: "25" });
    if (eventType) query.set("eventType", eventType);
    if (cursor) query.set("cursor", cursor);
    return request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/audit?${query}`,
      auditPageSchema,
    );
  },
  recheckReconciliation: (organizationId: string, caseId: string) =>
    request(
      `/v1/orgs/${encodeURIComponent(organizationId)}/operations/reconciliation/${encodeURIComponent(caseId)}/recheck`,
      recheckSchema,
      { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
      true,
    ),
};
