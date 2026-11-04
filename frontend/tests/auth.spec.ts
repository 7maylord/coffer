import { expect, test, type Page } from "@playwright/test";

const session = (role = "OWNER") => ({
  sessionId: "session-1",
  userId: "user-1",
  expiresAt: "2026-11-02T12:00:00.000Z",
  wallets: [{ network: "testnet", accountId: "jamie.testnet" }],
  memberships: [{ organizationId: "org-1", role }],
});

const organization = (role = "OWNER") => ({
  id: "org-1",
  slug: "forma-studio",
  name: "Forma Studio",
  role,
});

async function mockAuthenticated(page: Page, role = "OWNER") {
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({ status: 200, json: session(role) }),
  );
  await page.route("**/api/coffer/v1/organizations", (route) =>
    route.fulfill({ status: 200, json: [organization(role)] }),
  );
}

test("logged-out and unavailable sessions fail closed", async ({ page }) => {
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({ status: 401 }),
  );
  await page.goto("/overview");
  await expect(
    page.getByRole("heading", { name: "Step into your coffer." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with a NEAR wallet" }),
  ).toBeVisible();
  await expect(page.getByText("Privy social login is available")).toBeVisible();

  await page.unroute("**/api/coffer/v1/auth/session");
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.reload();
  await expect(page.locator(".form-alert")).toContainText(
    "could not reach its API",
  );
  await expect(
    page.getByRole("button", { name: "Try the API again" }),
  ).toBeVisible();
});

test("verified session restores organization identity and role guards", async ({
  page,
  isMobile,
}) => {
  await mockAuthenticated(page, "EMPLOYEE");
  await page.goto("/payroll");
  await expect(
    page.getByText("TESTNET SESSION", { exact: true }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("button", { name: /jamie\.testnet employee/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Forma Studio/i })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace navigation" }),
  ).not.toContainText("Invoices");

  await page.goto("/invoices");
  await expect(
    page.getByRole("heading", { name: "This page is outside your role." }),
  ).toBeVisible();
  await expect(page.getByText("API enforces authorization")).toBeVisible();
});

test("a revoked or expired session returns to sign-in on revalidation", async ({
  page,
}) => {
  let active = true;
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    active
      ? route.fulfill({ status: 200, json: session() })
      : route.fulfill({ status: 401 }),
  );
  await page.route("**/api/coffer/v1/organizations", (route) =>
    route.fulfill({ status: 200, json: [organization()] }),
  );
  await page.goto("/overview");
  await expect(
    page.getByText("TESTNET SESSION", { exact: true }),
  ).toBeVisible();
  active = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Step into your coffer." }),
  ).toBeVisible();
});

test("logout supplies CSRF and clears the authenticated shell", async ({
  context,
  page,
  isMobile,
}) => {
  const csrf = "b".repeat(43);
  await context.addCookies([
    {
      name: "coffer_csrf",
      value: csrf,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Strict",
    },
  ]);
  await mockAuthenticated(page);
  await page.route("**/api/coffer/v1/auth/logout", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
    await route.fulfill({ status: 201, json: { status: "revoked" } });
  });
  await page.goto("/overview");
  await expect(
    page.getByText("TESTNET SESSION", { exact: true }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: /jamie\.testnet owner/i }).click();
  await expect(
    page.getByRole("heading", { name: "Step into your coffer." }),
  ).toBeVisible();
});

test("first wallet session creates an owner organization with CSRF", async ({
  context,
  page,
  isMobile,
}) => {
  const csrf = "a".repeat(43);
  await context.addCookies([
    {
      name: "coffer_csrf",
      value: csrf,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Strict",
    },
  ]);
  let organizations: ReturnType<typeof organization>[] = [];
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({ status: 200, json: session() }),
  );
  await page.route("**/api/coffer/v1/organizations", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().headers()["x-csrf-token"]).toBe(csrf);
      expect(await route.request().postDataJSON()).toEqual({
        name: "North Star",
        slug: "north-star",
      });
      organizations = [
        { ...organization(), name: "North Star", slug: "north-star" },
      ];
      await route.fulfill({ status: 201, json: organizations[0] });
      return;
    }
    await route.fulfill({ status: 200, json: organizations });
  });

  await page.goto("/overview");
  await expect(
    page.getByRole("heading", { name: "Name your workspace." }),
  ).toBeVisible();
  await page.getByLabel("Workspace name").fill("North Star");
  await expect(page.getByLabel("Workspace URL key")).toHaveValue("north-star");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByText("TESTNET SESSION", { exact: true }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: /North Star/i })).toBeVisible();
});
