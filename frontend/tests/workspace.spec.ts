import { test, expect, type Page } from "@playwright/test";
const routes = [
  "overview",
  "treasury",
  "invoices",
  "approvals",
  "cfo",
  "agents",
  "payroll",
  "activity",
  "settings",
];
async function navigate(page: Page, label: string, mobile: boolean) {
  if (mobile)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: new RegExp(`^${label}`) })
    .click();
}
test("every page renders without errors, external service calls, or horizontal overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:3100")
    )
      external.push(request.url());
  });
  for (const route of ["", ...routes]) {
    await page.goto(route ? `/demo/${route}` : "/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBeTruthy();
    if (route)
      await expect(page.getByText("DEMO MODE", { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("landing sculpture and workspace entry work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(
    page.getByText("Give autonomy a thoughtful boundary."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Find your flow" }).click();
  await expect(page).toHaveURL(/\/demo\/overview$/);
});
test("invoice draft, validation, filtering, preview, and CSV export", async ({
  page,
}) => {
  await page.goto("/demo/invoices");
  await page
    .getByRole("button", { name: "Create invoice", exact: true })
    .click();
  await page.getByLabel("Demo client").fill("Acme Demo");
  await page.getByLabel("What is it for?").fill("Synthetic brand design");
  await page.getByLabel("Amount · demo USD").fill("10.001");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "two decimal places",
  );
  await page.getByLabel("Amount · demo USD").fill("100.01");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Find an invoice").fill("Acme Demo");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("$100.01");
  await page.getByRole("button", { name: "View INV-DEMO-6" }).click();
  await expect(page.getByRole("dialog")).toContainText("Preview only");
  await page.getByRole("button", { name: "Close dialog" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("coffer-demo-invoices.csv");
  await page.getByLabel("Find an invoice").fill("no-match");
  await expect(page.getByText("No invoices here, yet.")).toBeVisible();
});
test("treasury proposals flow into a single demo review without moving money", async ({
  page,
  isMobile,
}) => {
  await page.goto("/demo/treasury");
  await page.getByRole("button", { name: "Propose allocation" }).click();
  await page.getByLabel("Total allocation · demo USD").fill("70000");
  await page.getByRole("button", { name: "Create demo proposal" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "exceeds",
  );
  await page.getByLabel("Total allocation · demo USD").fill("100.01");
  await expect(page.getByRole("dialog")).toContainText("$20.01");
  await page.getByRole("button", { name: "Create demo proposal" }).click();
  await navigate(page, "Approvals", isMobile);
  await page
    .locator("article")
    .filter({ hasText: "Studio revenue allocation" })
    .getByRole("button", { name: "View proposal" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Disabled");
  await page.getByRole("button", { name: "Record demo review" }).click();
  await page.getByRole("button", { name: "Reviewed", exact: true }).click();
  const card = page
    .locator("article")
    .filter({ hasText: "Studio revenue allocation" });
  await expect(card).toContainText("1 of 2 demo reviews");
  await card.getByRole("button", { name: "View proposal" }).click();
  await expect(
    page.getByRole("button", { name: "Record demo review" }),
  ).toHaveCount(0);
});
test("CFO proposals, agent pause, and payroll disclosures", async ({
  page,
  isMobile,
}) => {
  await page.goto("/demo/cfo");
  await page.getByLabel("Allocation budget").fill("100.01");
  await page.getByRole("button", { name: "Explore an allocation" }).click();
  await expect(page.getByText("$20.01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send to human review" }).click();
  await expect(
    page.getByRole("button", { name: "Sent to demo review" }),
  ).toBeDisabled();
  await navigate(page, "Agents", isMobile);
  await page.getByRole("button", { name: "Pause Scout" }).click();
  await page
    .locator("article")
    .filter({ hasText: "Scout" })
    .getByRole("button", { name: "View agent" })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview a service offer" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await navigate(page, "Payroll", isMobile);
  await expect(
    page.getByText("Hiding demo amounts is a display preference", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show demo amounts" }).click();
  await expect(page.getByText("$4,200.00", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Preview", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "not implement employee authentication",
  );
});
test("command palette, motion preference, settings and reset", async ({
  page,
}) => {
  await page.goto("/demo/overview");
  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByRole("textbox", { name: "Search pages" }).fill("settings");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByLabel("Demo workspace name").fill("Demo Collective");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("updated");
  await page.getByRole("switch", { name: "Reduce motion" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("button", { name: "Start fresh" }).click();
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(page.getByLabel("Demo workspace name")).toHaveValue(
    "Forma Studio",
  );
  await expect(page.getByRole("switch")).not.toBeChecked();
});
test("reduced-motion preference stops decorative movement and dialogs trap focus", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page
      .locator(".hero-asterisk")
      .evaluate((el) => getComputedStyle(el).animationDuration),
  ).toBe("1e-05s");
  await page.goto("/demo/invoices");
  await page
    .getByRole("button", { name: "Create invoice", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  if (!isMobile)
    await expect(
      page.getByRole("button", { name: "Create invoice", exact: true }),
    ).toBeFocused();
});
