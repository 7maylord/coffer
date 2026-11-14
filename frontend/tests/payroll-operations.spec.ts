import { expect, test, type Page } from "@playwright/test";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const batchId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const paymentId = "55555555-5555-4555-8555-555555555555";
const caseId = "66666666-6666-4666-8666-666666666666";
const eventId = "77777777-7777-4777-8777-777777777777";
const actionId = "88888888-8888-4888-8888-888888888888";
const pendingId = "99999999-9999-4999-8999-999999999999";
const refundedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const settledId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const financeRunId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const postingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const journalId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const reservationId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const agentId = "12121212-1212-4212-8212-121212121212";
const offerId = "13131313-1313-4313-8313-131313131313";
const purchaseId = "14141414-1414-4414-8414-141414141414";
const proposalId = "15151515-1515-4515-8515-151515151515";
const digest = "a".repeat(64);

async function authenticated(page: Page, role: string) {
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        sessionId: "session-1",
        userId,
        expiresAt: "2099-11-02T12:00:00.000Z",
        wallets: [{ network: "testnet", accountId: "owner.testnet" }],
        memberships: [{ organizationId: orgId, role }],
      },
    }),
  );
  await page.route("**/api/coffer/v1/organizations", (route) =>
    route.fulfill({
      json: [{ id: orgId, slug: "forma", name: "Forma Studio", role }],
    }),
  );
}

function summary(status = "DRAFT") {
  return {
    id: batchId,
    organizationId: orgId,
    reference: "SYNTHETIC-NOV",
    status,
    assetId: "mock:near:usdc",
    manifestDigest: digest,
    totalGrossAtomic: "1000000",
    totalNetAtomic: "1000000",
    lineCount: 1,
    calculationAssumption: "SYNTHETIC_NO_TAX",
    approvedManifestDigest: status === "APPROVED" ? digest : null,
    approvedAt: status === "APPROVED" ? "2026-11-01T12:00:00.000Z" : null,
    version: status === "APPROVED" ? 2 : 1,
    confidentiality:
      "Synthetic payroll with application-layer envelope encryption; no legal tax calculation",
  };
}

function batch() {
  return {
    ...summary(),
    lines: [
      {
        id: lineId,
        employeeCode: "EMP-001",
        userId,
        grossAmountAtomic: "1000000",
        netAmountAtomic: "1000000",
        profile: {
          legalName: "Synthetic Person",
          address: "Synthetic Address",
          payoutAccount: "employee.testnet",
        },
      },
    ],
  };
}

function dashboard() {
  const attempt = {
    id: paymentId,
    provider: "mock",
    status: "UNKNOWN_REQUIRES_RECONCILIATION",
    version: 3,
    pollCount: 2,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:10:00.000Z",
    reconciliationCase: {
      id: caseId,
      reasonCode: "PROVIDER_STATUS_UNKNOWN",
      status: "OPEN",
      createdAt: "2026-11-01T10:10:00.000Z",
    },
  };
  return {
    generatedAt: "2026-11-01T12:00:00.000Z",
    stuckThresholdSeconds: 300,
    queued: [],
    pending: [
      {
        ...attempt,
        id: pendingId,
        status: "PROCESSING",
        reconciliationCase: null,
      },
    ],
    stuck: [attempt],
    refunded: [
      {
        ...attempt,
        id: refundedId,
        status: "REFUNDED",
        reconciliationCase: null,
      },
    ],
    completed: [
      {
        ...attempt,
        id: settledId,
        status: "SETTLED",
        reconciliationCase: null,
      },
    ],
  };
}

async function operationsRoutes(page: Page) {
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/operations/settlements`,
    (route) => route.fulfill({ json: dashboard() }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/operations/metrics`,
    (route) =>
      route.fulfill({
        json: {
          generatedAt: "2026-11-01T12:00:00.000Z",
          paymentsByStatus: { UNKNOWN_REQUIRES_RECONCILIATION: 1 },
          queuedOutboxEvents: 0,
          openReconciliationCases: 1,
          stalePendingPayments: 0,
          oldestQueuedAt: null,
        },
      }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/operations/finance-agent-runs?**`,
    (route) =>
      route.fulfill({
        json: [
          {
            id: financeRunId,
            state: "PROCUREMENT_AWAITING_APPROVAL",
            triggerType: "INVOICE_SETTLED",
            objective: "ALLOCATE_VERIFIED_INVOICE_REVENUE",
            correlationId: "finance-agent-correlation-1",
            evidence: {
              invoiceId: batchId,
              paymentAttemptId: paymentId,
              settlementPostingId: postingId,
              journalId,
            },
            inference: {
              status: "VERIFIED",
              provider: "near-ai-cloud",
              model: "near-ai/verified-model",
              attestationStatus: "VERIFIED_PROVIDER_TEE",
              inputDigest: digest,
              responseDigest: "b".repeat(64),
              errorCode: null,
            },
            policy: {
              outcome: "ALLOW",
              reasonCodes: [],
              digest: "c".repeat(64),
              version: 1,
              instructionDigest: "d".repeat(64),
            },
            reservation: {
              id: reservationId,
              status: "ACTIVE",
              assetId: "mock:near:usdc",
              amountAtomic: "250",
              expiresAt: "2026-11-21T12:00:00.000Z",
            },
            approvalBoundary: {
              backendSigning: false,
              mode: "HUMAN_APPROVAL_REQUIRED",
              transferExecution: "SEEDED_FULFILMENT_ONLY",
              proposalId,
              proposalStatus: "PENDING",
              approvalCount: 0,
              approvalThreshold: 2,
            },
            procurement: {
              agentId,
              offerId,
              purchaseId,
              status: "AWAITING_APPROVAL",
              providerMode: "SEEDED_PROTOTYPE",
              liveSettlement: false,
            },
            reconciliation: {
              paymentStatus: "SETTLED",
              provider: "direct-near-testnet",
              settlementCompletedAt: "2026-11-14T12:00:00.000Z",
              caseStatus: null,
              reasonCode: null,
            },
            steps: [
              [
                "TRIGGER",
                "COMPLETE",
                "Verified invoice settlement triggered the run",
                "INVOICE_SETTLED",
              ],
              [
                "EVIDENCE",
                "COMPLETE",
                "Settlement evidence and ledger posting",
                "Balanced journal evidence linked",
              ],
              [
                "INFERENCE",
                "COMPLETE",
                "Private inference verification",
                "VERIFIED_PROVIDER_TEE",
              ],
              ["POLICY", "COMPLETE", "Deterministic policy decision", "ALLOW"],
              [
                "RESERVATION",
                "COMPLETE",
                "Internal ledger reservation",
                "ACTIVE",
              ],
              [
                "APPROVAL_BOUNDARY",
                "BLOCKED",
                "Human authorization boundary",
                "PENDING; seeded fulfilment only",
              ],
              [
                "RECONCILIATION",
                "COMPLETE",
                "Independent settlement reconciliation",
                "SETTLED",
              ],
            ].map(([code, status, title, detail], index) => ({
              code,
              status,
              title,
              detail,
              occurredAt: `2026-11-14T12:0${index}:00.000Z`,
            })),
            createdAt: "2026-11-14T12:00:00.000Z",
            updatedAt: "2026-11-14T12:06:00.000Z",
          },
        ],
      }),
  );
  await page.route(`**/api/coffer/v1/orgs/${orgId}/audit?**`, (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: eventId,
            sequence: 1,
            actorId: userId,
            eventType: "PAYMENT_STATUS_CHANGED",
            entityType: "PAYMENT_ATTEMPT",
            entityId: paymentId,
            correlationId: "correlation-1",
            traceId: null,
            previousHash: null,
            eventHash: digest,
            metadata: { salary: "[REDACTED]" },
            createdAt: "2026-11-01T10:10:00.000Z",
          },
        ],
        nextCursor: null,
        integrity: {
          verified: true,
          eventCount: 1,
          headHash: digest,
          algorithm: "SHA-256",
        },
      },
    }),
  );
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "coffer_csrf",
      value: "c".repeat(43),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
});

test("finance reviews exact encrypted payroll evidence and approves its manifest", async ({
  page,
}) => {
  await authenticated(page, "FINANCE_ADMIN");
  await page.route(`**/api/coffer/v1/orgs/${orgId}/payroll/batches`, (route) =>
    route.fulfill({ json: [summary()] }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}`,
    (route) => route.fulfill({ json: batch() }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}/analysis`,
    async (route) => {
      const input = route.request().postDataJSON() as { mode: string };
      if (input.mode === "private-ai") {
        await route.fulfill({ status: 503, json: { statusCode: 503 } });
        return;
      }
      expect(input).toEqual({ mode: "deterministic" });
      await route.fulfill({
        json: {
          id: "analysis-1",
          mode: "deterministic",
          findings: [],
          attestationStatus: "NOT_REQUESTED",
          confidentiality:
            "Deterministic local analysis; no private AI or TEE claim",
        },
      });
    },
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}/approve`,
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        expectedManifestDigest: digest,
        expectedVersion: 1,
      });
      await route.fulfill({ json: summary("APPROVED") });
    },
  );

  await page.goto("/payroll");
  await expect(page.getByText("Synthetic Person")).toBeVisible();
  await expect(
    page.getByText("Encrypted at rest", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Mock batches stop after review and approval", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run local rules" }).click();
  await expect(page.getByText("NOT_REQUESTED")).toBeVisible();
  await page.getByRole("button", { name: "Try verified private AI" }).click();
  await expect(
    page.getByText("private analysis is unavailable", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve exact manifest" }).click();
  expect(page.url()).not.toContain("1000000");
});

test("finance builds a strict synthetic payroll batch one employee at a time", async ({
  page,
}) => {
  await authenticated(page, "FINANCE_ADMIN");
  let imported = false;
  let submittedCsv = "";
  await page.route(`**/api/coffer/v1/orgs/${orgId}/members`, (route) =>
    route.fulfill({
      json: [
        {
          userId,
          displayName: "Synthetic Person",
          role: "EMPLOYEE",
          wallets: [{ network: "testnet", accountId: "employee.testnet" }],
        },
      ],
    }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/imports`,
    async (route) => {
      const input = route.request().postDataJSON() as { csv: string };
      submittedCsv = input.csv;
      imported = true;
      await route.fulfill({ status: 201, json: summary() });
    },
  );
  await page.route(`**/api/coffer/v1/orgs/${orgId}/payroll/batches`, (route) =>
    route.fulfill({ json: imported ? [summary()] : [] }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}`,
    (route) => route.fulfill({ json: batch() }),
  );

  await page.goto("/payroll");
  await page.getByRole("button", { name: "Add employees" }).click();
  const dialog = page.getByRole("dialog", { name: "Build payroll manually" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Reference").fill("SYNTHETIC-NOV");
  await dialog.getByLabel("Employee member").selectOption(userId);
  await dialog.getByLabel("Employee code").fill("EMP-001");
  await dialog.getByLabel("Address · synthetic").fill("12 Example Road, Lagos");
  await dialog.getByLabel("Gross amount · atomic").fill("1000000");
  await dialog.getByRole("button", { name: "Add employee" }).click();
  await expect(dialog.getByText("EMP-001")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Encrypt and import 1 employee" })
    .click();

  await expect(dialog).toBeHidden();
  expect(submittedCsv).toBe(
    [
      "employee_code,user_id,legal_name,address,payout_account,gross_amount_atomic",
      `EMP-001,${userId},Synthetic Person,"12 Example Road, Lagos",employee.testnet,1000000`,
    ].join("\n"),
  );
});

test("employee payroll uses only the self-scoped payslip collection", async ({
  page,
}) => {
  await authenticated(page, "EMPLOYEE");
  let organizationPayrollCalled = false;
  await page.route(`**/api/coffer/v1/orgs/${orgId}/payroll/**`, (route) => {
    organizationPayrollCalled = true;
    return route.abort();
  });
  await page.route("**/api/coffer/v1/me/payslips", (route) =>
    route.fulfill({
      json: [
        {
          id: lineId,
          batchId,
          reference: "SYNTHETIC-NOV",
          status: "APPROVED",
          assetId: "mock:near:usdc",
          employeeCode: "EMP-001",
          legalName: "Synthetic Person",
          address: "Synthetic Address",
          payoutAccount: "employee.testnet",
          grossAmountAtomic: "1000000",
          netAmountAtomic: "1000000",
          calculationAssumption: "SYNTHETIC_NO_TAX",
          confidentiality:
            "Application-layer encrypted synthetic payroll; payout-chain privacy is not implied",
        },
      ],
    }),
  );

  await page.goto("/payroll");
  await expect(
    page.getByRole("heading", { name: "Your pay, your view." }),
  ).toBeVisible();
  await expect(page.getByText("employee.testnet")).toBeVisible();
  expect(organizationPayrollCalled).toBe(false);
});

test("finance prepares an approved payroll for verified wallet signing", async ({
  page,
}) => {
  await authenticated(page, "FINANCE_ADMIN");
  const approved = {
    ...summary("APPROVED"),
    assetId: "near:testnet:native",
  };
  await page.route(`**/api/coffer/v1/orgs/${orgId}/payroll/batches`, (route) =>
    route.fulfill({ json: [approved] }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}`,
    (route) => route.fulfill({ json: { ...batch(), ...approved } }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}/payouts`,
    async (route) => {
      expect(route.request().headers()["idempotency-key"]).toBe(
        `payroll:${batchId}:v2`,
      );
      expect(route.request().postDataJSON()).toEqual({
        signerAccountId: "owner.testnet",
      });
      await route.fulfill({
        json: {
          id: paymentId,
          batchId,
          status: "PREPARED",
          signerAccountId: "owner.testnet",
          approvedManifestDigest: digest,
          settledAt: null,
          items: [
            {
              id: actionId,
              payrollLineId: lineId,
              status: "PREPARED",
              transactionHash: null,
              evidenceDigest: null,
              verifiedAt: null,
              transaction: {
                network: "testnet",
                signerAccountId: "owner.testnet",
                receiverId: "employee.testnet",
                actions: [{ type: "Transfer", amountAtomic: "1000000" }],
              },
            },
          ],
        },
      });
    },
  );

  await page.goto("/payroll");
  await page.getByRole("button", { name: "Prepare wallet payouts" }).click();
  await expect(
    page.getByRole("region", { name: "Payroll payout verification" }),
  ).toContainText("EMP-001 · PREPARED");
  await expect(
    page.getByRole("button", { name: "Sign and verify payout" }),
  ).toBeVisible();
});

test("finance rechecks uncertain payout evidence without requesting another signature", async ({
  page,
}) => {
  await authenticated(page, "FINANCE_ADMIN");
  const approved = {
    ...summary("APPROVED"),
    status: "PROCESSING",
    assetId: "near:testnet:native",
  };
  const reconciling = {
    id: paymentId,
    batchId,
    status: "PROCESSING",
    signerAccountId: "owner.testnet",
    approvedManifestDigest: digest,
    settledAt: null,
    items: [
      {
        id: actionId,
        payrollLineId: lineId,
        status: "RECONCILING",
        transactionHash: "1".repeat(43),
        evidenceDigest: null,
        verifiedAt: null,
        transaction: null,
      },
    ],
  };
  await page.route(`**/api/coffer/v1/orgs/${orgId}/payroll/batches`, (route) =>
    route.fulfill({ json: [approved] }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}`,
    (route) => route.fulfill({ json: { ...batch(), ...approved } }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}/payouts`,
    (route) => route.fulfill({ json: reconciling }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/payroll/batches/${batchId}/payouts/items/${actionId}/reconcile`,
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        transactionHash: "1".repeat(43),
      });
      await route.fulfill({
        json: {
          ...reconciling,
          status: "SETTLED",
          settledAt: "2026-11-14T00:00:00.000Z",
          items: [
            {
              ...reconciling.items[0],
              status: "VERIFIED",
              evidenceDigest: "e".repeat(64),
              verifiedAt: "2026-11-14T00:00:00.000Z",
            },
          ],
        },
      });
    },
  );

  await page.goto("/payroll");
  await page.getByRole("button", { name: "Prepare wallet payouts" }).click();
  await expect(
    page.getByRole("button", { name: "Recheck transfer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign and verify payout" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Recheck transfer" }).click();
  await expect(
    page.getByRole("region", { name: "Payroll payout verification" }),
  ).toContainText("VERIFIED");
});

test("finance queues a reconciliation recheck without changing unknown status", async ({
  page,
}) => {
  await authenticated(page, "FINANCE_ADMIN");
  await operationsRoutes(page);
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/operations/reconciliation/${caseId}/recheck`,
    async (route) => {
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      expect(route.request().postData()).toBeNull();
      await route.fulfill({
        json: {
          actionId,
          caseId,
          paymentId,
          action: "RECHECK_EXISTING_PAYMENT",
          status: "QUEUED",
          createdAt: "2026-11-01T12:01:00.000Z",
        },
      });
    },
  );

  await page.goto("/activity");
  await expect(page.getByText("Audit integrity")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Finance Agent run timeline" }),
  ).toContainText("Finance Agent runs");
  await expect(page.getByText("Backend signing: disabled")).toBeVisible();
  await expect(
    page.getByText("seeded fulfilment only", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Queue safe recheck" }).click();
  await expect(
    page.getByText("payment remains uncertain", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("UNKNOWN REQUIRES RECONCILIATION")).toBeVisible();
  await expect(page.getByText("PROCESSING", { exact: true })).toBeVisible();
  await expect(page.getByText("REFUNDED", { exact: true })).toBeVisible();
  await expect(
    page.locator(".operations-board .api-status").filter({ hasText: "SETTLED" }),
  ).toBeVisible();
});

test("Finance Agent evidence timeline remains usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticated(page, "AUDITOR");
  await operationsRoutes(page);
  await page.goto("/activity");
  const timeline = page.getByRole("region", {
    name: "Finance Agent run timeline",
  });
  await expect(timeline).toBeVisible();
  await expect(
    timeline.getByText("Human authorization boundary"),
  ).toBeVisible();
  await expect(
    timeline.getByText("Independent settlement reconciliation"),
  ).toBeVisible();
});

test("auditor can verify the timeline but cannot queue reconciliation", async ({
  page,
}) => {
  await authenticated(page, "AUDITOR");
  await operationsRoutes(page);
  await page.goto("/activity");
  await expect(page.getByText("PAYMENT_STATUS_CHANGED")).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue safe recheck" }),
  ).toHaveCount(0);
});
