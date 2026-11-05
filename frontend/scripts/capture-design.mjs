import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const directory = new URL("../../docs/design/screenshots/", import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    for (const route of [
      "",
      "overview",
      "treasury",
      "invoices",
      "approvals",
      "cfo",
      "agents",
      "payroll",
      "activity",
      "settings",
    ]) {
      const path = route ? `/demo/${route}` : "/";
      await page.goto(`http://127.0.0.1:3100${path}`);
      await page.locator("h1").waitFor();
      await page.screenshot({
        path: new URL(
          `${route || "landing"}-${mobile ? "mobile" : "desktop"}.png`,
          directory,
        ).pathname,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.goto("http://127.0.0.1:3100/overview");
    await page.locator("h1").waitFor();
    await page.screenshot({
      path: new URL(
        `sign-in-api-unavailable-${mobile ? "mobile" : "desktop"}.png`,
        directory,
      ).pathname,
      fullPage: true,
      animations: "disabled",
    });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(
  "Captured the landing page, nine demo routes, and the API-unavailable sign-in state at desktop and mobile widths in docs/design/screenshots.",
);
