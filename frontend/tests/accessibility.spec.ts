import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/demo/overview",
  "/demo/treasury",
  "/demo/invoices",
  "/demo/approvals",
  "/demo/cfo",
  "/demo/agents",
  "/demo/payroll",
  "/demo/activity",
  "/demo/settings",
];

test("public and demo routes have no automated WCAG A/AA violations", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const violations = results.violations.map(
      ({ id, nodes }) =>
        `${id} (${nodes.length}): ${nodes
          .slice(0, 100)
          .map(({ target }) => target.join(" > "))
          .join("; ")}`,
    );
    expect(violations, `${route}: ${violations.join(", ")}`).toEqual([]);
  }
});

test("skip navigation moves keyboard focus to the main content", async ({
  page,
}) => {
  await page.goto("/demo/overview");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-content")).toBeFocused();
});

test("demo routes reflow without horizontal overflow at 320px", async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.setViewportSize({ width: 320, height: 568 });
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      `${route} overflows at 320px`,
    ).toBeTruthy();
  }
});
