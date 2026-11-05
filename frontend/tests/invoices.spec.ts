import { expect, test, type Page } from "@playwright/test";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const invoiceId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";
const paymentId = "55555555-5555-4555-8555-555555555555";
const token = "p".repeat(43);

async function authenticated(page: Page) {
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      json: {
        sessionId: "session-1",
        userId,
        expiresAt: "2026-11-02T12:00:00.000Z",
        wallets: [{ network: "testnet", accountId: "jamie.testnet" }],
        memberships: [{ organizationId: orgId, role: "OWNER" }],
      },
    }),
  );
  await page.route("**/api/coffer/v1/organizations", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: orgId, slug: "forma", name: "Forma Studio", role: "OWNER" }],
    }),
  );
}

function invoice(status: "DRAFT" | "ISSUED" | "PAID" = "DRAFT") {
  const paid = status === "PAID";
  return {
    id: invoiceId,
    organizationId: orgId,
    invoiceNumber: "INV-2026-0042",
    status,
    paymentState: paid ? "PAID" : "UNPAID",
    currency: "mock:near:usdc",
    totalAmountAtomic: "12500001",
    verifiedReceivedAtomic: paid ? "12500001" : "0",
    outstandingAmountAtomic: paid ? "0" : "12500001",
    payeeDestination: "merchant.testnet",
    customer: { displayName: "Northstar Labs", email: "pay@northstar.test" },
    lineItems: [{ description: "Protocol design", amountAtomic: "12500001" }],
    metadata: {},
    dueDate: "2026-11-30T23:59:59.000Z",
    revision: 1,
    version: status === "DRAFT" ? 1 : 2,
    createdByUserId: userId,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    issuedAt: status === "DRAFT" ? null : "2026-11-01T10:01:00.000Z",
    expiredAt: null,
    voidedAt: null,
    paidAt: paid ? "2026-11-01T10:05:00.000Z" : null,
    paymentAttempts: [],
  };
}

function publicInvoice(paid = false) {
  const source = invoice(paid ? "PAID" : "ISSUED");
  const {
    invoiceNumber,
    status,
    paymentState,
    currency,
    totalAmountAtomic,
    verifiedReceivedAtomic,
    outstandingAmountAtomic,
    payeeDestination,
    lineItems,
    dueDate,
  } = source;
  return {
    invoiceNumber,
    status,
    paymentState,
    currency,
    totalAmountAtomic,
    verifiedReceivedAtomic,
    outstandingAmountAtomic,
    payeeDestination,
    lineItems,
    dueDate,
  };
}

async function mockTerminalJourney(
  page: Page,
  scenario: "refund" | "partial_deposit",
  status: "REFUNDED" | "UNDERFUNDED",
) {
  await page.route(`**/api/coffer/v1/public/invoices/${token}`, (route) =>
    route.fulfill({ status: 200, json: publicInvoice(false) }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/settlement/assets`,
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          mode: "mock",
          assets: [
            { id: "mock:base:usdc", chain: "base-mock", decimals: 6 },
            { id: "mock:near:usdc", chain: "near-mock", decimals: 6 },
          ],
        },
      }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/quotes`,
    async (route) => {
      expect((await route.request().postDataJSON()).scenario).toBe(scenario);
      await route.fulfill({
        status: 201,
        json: {
          id: quoteId,
          sourceAssetId: "mock:base:usdc",
          destinationAssetId: "mock:near:usdc",
          amountAtomic: "12500001",
          expectedAmountAtomic: "12500001",
          recipient: "merchant.testnet",
          refundTo: "payer.testnet",
          slippageBps: 50,
          confidentiality: "none",
          scenario,
          provider: "mock",
          expiresAt: "2026-11-01T12:10:00.000Z",
        },
      });
    },
  );
  const attempt = (nextStatus: "AWAITING_DEPOSIT" | typeof status) => ({
    id: paymentId,
    quoteId,
    provider: "mock",
    scenario,
    status: nextStatus,
    version: nextStatus === "AWAITING_DEPOSIT" ? 1 : 2,
    settlementPostingCount: 0,
    refundPostingCount: nextStatus === "REFUNDED" ? 1 : 0,
    pollCount: nextStatus === "AWAITING_DEPOSIT" ? 0 : 1,
    history: [
      {
        status: "AWAITING_DEPOSIT",
        observedAt: "2026-11-01T12:00:00.000Z",
        eventId: "created",
      },
      ...(nextStatus === "AWAITING_DEPOSIT"
        ? []
        : [
            {
              status: nextStatus,
              observedAt: "2026-11-01T12:01:00.000Z",
              eventId: "terminal",
            },
          ]),
    ],
  });
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/payments`,
    (route) =>
      route.fulfill({
        status: 201,
        json: attempt("AWAITING_DEPOSIT"),
      }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/payments/${paymentId}/poll`,
    (route) => route.fulfill({ status: 201, json: attempt(status) }),
  );

  await page.goto(`/pay/${token}`);
  await page.getByLabel("Mock refund destination").fill("payer.testnet");
  await page.getByLabel("Demo settlement outcome").selectOption(scenario);
  await page.getByRole("button", { name: /Review mock quote/ }).click();
  await page.getByRole("button", { name: /Authorize mock payment/ }).click();
  await page.getByRole("button", { name: /Check settlement/ }).click();
  await expect(page.getByText("Not paid", { exact: true })).toBeVisible();
  await expect(page.getByText("ISSUED · UNPAID")).toBeVisible();
}

test("staff create and issue an exact-amount hosted invoice", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "coffer_csrf",
      value: "c".repeat(43),
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Strict",
    },
  ]);
  await authenticated(page);
  let current: ReturnType<typeof invoice> | null = null;
  await page.route(`**/api/coffer/v1/orgs/${orgId}/invoices`, async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(43));
      const body = await route.request().postDataJSON();
      expect(body.lineItems[0].amountAtomic).toBe("12500001");
      expect(body.currency).toBe("mock:near:usdc");
      current = invoice();
      await route.fulfill({
        status: 201,
        json: { invoice: current, publicToken: token },
      });
      return;
    }
    await route.fulfill({ status: 200, json: current ? [current] : [] });
  });
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/invoices/${invoiceId}/issue`,
    async (route) => {
      current = invoice("ISSUED");
      await route.fulfill({ status: 201, json: current });
    },
  );

  await page.goto("/invoices");
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByLabel("Invoice number").fill("INV-2026-0042");
  await page.getByLabel("Due date").fill("2026-11-30");
  await page.getByLabel("Customer name").fill("Northstar Labs");
  await page.getByLabel("Customer email · optional").fill("pay@northstar.test");
  await page.getByLabel("Line item").fill("Protocol design");
  await page.getByLabel("Amount · Mock USDC").fill("12.500001");
  await page.getByLabel("NEAR recipient").fill("merchant.testnet");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("12.500001", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText("HOSTED PAYMENT")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open payer view/ }),
  ).toHaveAttribute("href", `/pay/${token}`);
});

test("hosted mock payment becomes paid only after terminal reconciliation", async ({
  page,
}) => {
  let polls = 0;
  let paid = false;
  await page.route(`**/api/coffer/v1/public/invoices/${token}`, (route) =>
    route.fulfill({ status: 200, json: publicInvoice(paid) }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/settlement/assets`,
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          mode: "mock",
          assets: [
            { id: "mock:base:usdc", chain: "base-mock", decimals: 6 },
            { id: "mock:near:usdc", chain: "near-mock", decimals: 6 },
          ],
        },
      }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/quotes`,
    async (route) => {
      const body = await route.request().postDataJSON();
      expect(body).toEqual({
        sourceAssetId: "mock:base:usdc",
        refundTo: "payer.testnet",
        slippageBps: 50,
        scenario: "success",
      });
      await route.fulfill({
        status: 201,
        json: {
          id: quoteId,
          sourceAssetId: "mock:base:usdc",
          destinationAssetId: "mock:near:usdc",
          amountAtomic: "12500001",
          expectedAmountAtomic: "12500001",
          recipient: "merchant.testnet",
          refundTo: "payer.testnet",
          slippageBps: 50,
          confidentiality: "none",
          scenario: "success",
          provider: "mock",
          expiresAt: "2026-11-01T12:10:00.000Z",
        },
      });
    },
  );
  const attempt = (status: string) => ({
    id: paymentId,
    quoteId,
    provider: "mock",
    scenario: "success",
    status,
    version: polls + 1,
    settlementPostingCount: status === "SETTLED" ? 1 : 0,
    refundPostingCount: 0,
    pollCount: polls,
    history: [
      {
        status: "AWAITING_DEPOSIT",
        observedAt: "2026-11-01T12:00:00.000Z",
        eventId: "created",
      },
      ...(status === "AWAITING_DEPOSIT"
        ? []
        : [
            {
              status,
              observedAt: "2026-11-01T12:01:00.000Z",
              eventId: `poll-${polls}`,
            },
          ]),
    ],
  });
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/payments`,
    (route) =>
      route.fulfill({ status: 201, json: attempt("AWAITING_DEPOSIT") }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/payments/${paymentId}/poll`,
    (route) => {
      polls += 1;
      const status =
        polls === 1
          ? "DEPOSIT_OBSERVED"
          : polls === 2
            ? "PROCESSING"
            : "SETTLED";
      if (status === "SETTLED") paid = true;
      return route.fulfill({ status: 201, json: attempt(status) });
    },
  );

  await page.goto(`/pay/${token}`);
  await expect(page.getByText("Simulation only.")).toBeVisible();
  await page.getByLabel("Mock refund destination").fill("payer.testnet");
  await page.getByRole("button", { name: /Review mock quote/ }).click();
  await expect(
    page
      .locator(".quote-card dl > div")
      .filter({ hasText: "Mock fee" })
      .getByText("0", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Authorize mock payment/ }).click();
  await expect(
    page.getByText("Coffer is waiting for independently verified"),
  ).toBeVisible();
  await expect(page.getByText("ISSUED · UNPAID")).toBeVisible();
  await page.getByRole("button", { name: /Check settlement/ }).click();
  await page.getByRole("button", { name: /Check settlement/ }).click();
  await page.getByRole("button", { name: /Check settlement/ }).click();
  await expect(page.getByText("Reconciled", { exact: true })).toBeVisible();
  await expect(page.getByText("PAID · PAID")).toBeVisible();
});

test("hosted unknown status remains explicitly unpaid", async ({ page }) => {
  await page.route(`**/api/coffer/v1/public/invoices/${token}`, (route) =>
    route.fulfill({ status: 200, json: publicInvoice(false) }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/settlement/assets`,
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          mode: "mock",
          assets: [
            { id: "mock:base:usdc", chain: "base-mock", decimals: 6 },
            { id: "mock:near:usdc", chain: "near-mock", decimals: 6 },
          ],
        },
      }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/quotes`,
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          id: quoteId,
          sourceAssetId: "mock:base:usdc",
          destinationAssetId: "mock:near:usdc",
          amountAtomic: "12500001",
          expectedAmountAtomic: "12500001",
          recipient: "merchant.testnet",
          refundTo: "payer.testnet",
          slippageBps: 50,
          confidentiality: "none",
          scenario: "unknown",
          provider: "mock",
          expiresAt: "2026-11-01T12:10:00.000Z",
        },
      }),
  );
  const base = {
    id: paymentId,
    quoteId,
    provider: "mock",
    scenario: "unknown",
    version: 1,
    settlementPostingCount: 0,
    refundPostingCount: 0,
    pollCount: 0,
  };
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/payments`,
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          ...base,
          status: "AWAITING_DEPOSIT",
          history: [
            {
              status: "AWAITING_DEPOSIT",
              observedAt: "2026-11-01T12:00:00.000Z",
              eventId: "created",
            },
          ],
        },
      }),
  );
  await page.route(
    `**/api/coffer/v1/public/invoices/${token}/payments/${paymentId}/poll`,
    (route) =>
      route.fulfill({
        status: 201,
        json: {
          ...base,
          status: "UNKNOWN_REQUIRES_RECONCILIATION",
          pollCount: 1,
          history: [
            {
              status: "AWAITING_DEPOSIT",
              observedAt: "2026-11-01T12:00:00.000Z",
              eventId: "created",
            },
            {
              status: "UNKNOWN_REQUIRES_RECONCILIATION",
              observedAt: "2026-11-01T12:01:00.000Z",
              eventId: "unknown",
            },
          ],
        },
      }),
  );

  await page.goto(`/pay/${token}`);
  await page.getByLabel("Mock refund destination").fill("payer.testnet");
  await page.getByLabel("Demo settlement outcome").selectOption("unknown");
  await page.getByRole("button", { name: /Review mock quote/ }).click();
  await page.getByRole("button", { name: /Authorize mock payment/ }).click();
  await page.getByRole("button", { name: /Check settlement/ }).click();
  await expect(page.getByText("Provider status is unknown")).toBeVisible();
  await expect(page.getByText("Not paid", { exact: true })).toBeVisible();
  await expect(page.getByText("ISSUED · UNPAID")).toBeVisible();
});

for (const edge of [
  {
    scenario: "refund" as const,
    status: "REFUNDED" as const,
    explanation: "refunded the source amount",
  },
  {
    scenario: "partial_deposit" as const,
    status: "UNDERFUNDED" as const,
    explanation: "deposit was incomplete",
  },
]) {
  test(`hosted ${edge.status.toLowerCase()} outcome never appears paid`, async ({
    page,
  }) => {
    await mockTerminalJourney(page, edge.scenario, edge.status);
    await expect(page.getByText(edge.explanation)).toBeVisible();
  });
}
