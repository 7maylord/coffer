import { expect, test, type Page } from "@playwright/test";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const invoiceId = "33333333-3333-4333-8333-333333333333";
const token = "p".repeat(43);
const amountAtomic = "12500001000000000000000000";

async function authenticated(page: Page) {
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      json: {
        sessionId: "session-1",
        userId,
        expiresAt: "2026-11-20T12:00:00.000Z",
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

function invoice(status: "DRAFT" | "ISSUED" = "DRAFT") {
  return {
    id: invoiceId,
    organizationId: orgId,
    invoiceNumber: "INV-2026-0042",
    status,
    paymentState: "UNPAID",
    currency: "near:testnet:native",
    totalAmountAtomic: amountAtomic,
    verifiedReceivedAtomic: "0",
    outstandingAmountAtomic: amountAtomic,
    payeeDestination: "merchant.testnet",
    customer: { displayName: "Northstar Labs", email: "pay@northstar.test" },
    lineItems: [{ description: "Protocol design", amountAtomic }],
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
    paidAt: null,
    paymentAttempts: [],
  };
}

test("staff create and issue an exact native-NEAR invoice", async ({
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
      const body = await route.request().postDataJSON();
      expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(43));
      expect(body.lineItems[0].amountAtomic).toBe(amountAtomic);
      expect(body.currency).toBe("near:testnet:native");
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
    (route) =>
      route.fulfill({ status: 201, json: (current = invoice("ISSUED")) }),
  );

  await page.goto("/invoices");
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByLabel("Invoice number").fill("INV-2026-0042");
  await page.getByLabel("Due date").fill("2026-11-30");
  await page.getByLabel("Customer name").fill("Northstar Labs");
  await page.getByLabel("Customer email · optional").fill("pay@northstar.test");
  await page.getByLabel("Line item").fill("Protocol design");
  await page.getByLabel("Amount · NEAR").fill("12.500001");
  await page.getByLabel("NEAR recipient").fill("merchant.testnet");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByText("HOSTED PAYMENT")).toBeVisible();
});

test("hosted invoice exposes the verified wallet payment boundary", async ({
  page,
}) => {
  await authenticated(page);
  const {
    customer: _customer,
    metadata: _metadata,
    ...publicFields
  } = invoice("ISSUED");
  const publicInvoice = {
    invoiceNumber: publicFields.invoiceNumber,
    status: publicFields.status,
    paymentState: publicFields.paymentState,
    currency: publicFields.currency,
    totalAmountAtomic: publicFields.totalAmountAtomic,
    verifiedReceivedAtomic: publicFields.verifiedReceivedAtomic,
    outstandingAmountAtomic: publicFields.outstandingAmountAtomic,
    payeeDestination: publicFields.payeeDestination,
    lineItems: publicFields.lineItems,
    dueDate: publicFields.dueDate,
  };
  await page.route(`**/api/coffer/v1/public/invoices/${token}`, (route) =>
    route.fulfill({ status: 200, json: publicInvoice }),
  );

  await page.goto(`/pay/${token}`);
  await expect(
    page.getByRole("heading", { name: /Approve the exact invoice amount/ }),
  ).toBeVisible();
  await expect(page.getByText("jamie.testnet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Pay with NEAR wallet/ }),
  ).toBeEnabled();
  await expect(page.getByText(/credits this invoice only after/)).toBeVisible();
});

test("invalid hosted token fails closed without exposing invoice data", async ({
  page,
}) => {
  await page.route(`**/api/coffer/v1/public/invoices/${token}`, (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto(`/pay/${token}`);
  await expect(
    page.getByRole("heading", { name: "Invoice unavailable." }),
  ).toBeVisible();
});
