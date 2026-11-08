import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type Fixture = {
  organizationId: string;
  sessionToken: string;
  csrfToken: string;
};

const databaseUrl =
  process.env.FULLSTACK_DATABASE_URL ??
  "postgresql://coffer:coffer_local@localhost:5433/coffer_dev";
const fixtureScript = resolve(
  process.cwd(),
  "../backend/scripts/seed-fullstack-e2e.mjs",
);
let fixture: Fixture;

test.beforeAll(() => {
  fixture = JSON.parse(
    execFileSync(process.execPath, [fixtureScript], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    }),
  ) as Fixture;
});

test("J-01 reaches paid through the real API and mock reconciliation", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "coffer_session",
      value: fixture.sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
    {
      name: "coffer_csrf",
      value: fixture.csrfToken,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Strict",
    },
  ]);

  const invoiceNumber = `FULLSTACK-${Date.now()}`;
  await page.goto("/invoices");
  await expect(page.getByText("SANDBOX", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByLabel("Invoice number").fill(invoiceNumber);
  await page.getByLabel("Due date").fill("2099-12-31");
  await page.getByLabel("Customer name").fill("Full-stack Customer");
  await page.getByLabel("Customer email").fill("customer@example.test");
  await page.getByLabel("Line item").fill("Synthetic integration work");
  await page.getByLabel("Amount · Mock USDC").fill("12.500001");
  await page.getByLabel("NEAR recipient").fill("merchant.testnet");
  await page.getByRole("button", { name: "Create draft" }).click();

  await expect(
    page.getByRole("dialog").getByText(invoiceNumber, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Issue invoice" }).click();
  const payerLink = page.getByRole("link", { name: /Open payer view/ });
  await expect(payerLink).toBeVisible();
  const payerPath = await payerLink.getAttribute("href");
  expect(payerPath).toMatch(/^\/pay\/[A-Za-z0-9_-]{43}$/);

  await page.goto(payerPath!);
  await expect(page.getByText(`INVOICE ${invoiceNumber}`)).toBeVisible();
  await page.getByLabel("Mock refund destination").fill("payer.testnet");
  await page.getByRole("button", { name: /Review mock quote/ }).click();
  await expect(
    page.getByRole("heading", { name: "Everything before authorization." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Authorize mock payment/ }).click();

  for (let poll = 0; poll < 3; poll += 1) {
    await page.getByRole("button", { name: /Check settlement/ }).click();
  }
  await expect(page.getByText("Reconciled", { exact: true })).toBeVisible();
  await expect(page.getByText("PAID · PAID", { exact: true })).toBeVisible();

  await page.goto("/invoices");
  await page.getByRole("button", { name: new RegExp(invoiceNumber) }).click();
  const invoiceDialog = page.getByRole("dialog");
  await expect(invoiceDialog.locator(".api-status")).toHaveText("PAID");
  await expect(
    invoiceDialog.getByText("12.500001", { exact: true }).first(),
  ).toBeVisible();
});
