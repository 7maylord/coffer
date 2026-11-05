import { expect, test, type Page } from "@playwright/test";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const proposalId = "44444444-4444-4444-8444-444444444444";
const revisionId = "55555555-5555-4555-8555-555555555555";
const digest = "a".repeat(64);
const policyDigest = "b".repeat(64);

async function authenticated(page: Page, role = "OWNER") {
  await page.route("**/api/coffer/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
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
      status: 200,
      json: [{ id: orgId, slug: "forma", name: "Forma Studio", role }],
    }),
  );
}

function approval(approverUserId: string, approverNearAccountId: string) {
  return {
    approverUserId,
    approverNearAccountId,
    approvedInstructionDigest: digest,
    createdAt: "2026-11-01T11:00:00.000Z",
  };
}

function proposal(overrides: Partial<ReturnType<typeof proposalBase>> = {}) {
  return { ...proposalBase(), ...overrides };
}

function proposalBase() {
  return {
    id: proposalId,
    organizationId: orgId,
    proposalKey: "66666666-6666-4666-8666-666666666666",
    revision: 1,
    proposalType: "treasury_split",
    status: "PENDING",
    policyDefinitionId: "77777777-7777-4777-8777-777777777777",
    policyVersion: 1,
    policyDigest,
    organizationCommitment: "c".repeat(64),
    proposalIdCommitment: "d".repeat(64),
    instructionDigest: digest,
    chainId: "internal:ledger",
    assetId: "mock:near:usdc",
    amountAtomic: "10000000000",
    authorizedMaxAtomic: "10000000000",
    recipientCommitment: "e".repeat(64),
    expiresAt: "2099-11-08T12:00:00.000Z",
    nonceCommitment: "f".repeat(64),
    idempotencyKeyCommitment: "1".repeat(64),
    operation: `reserve_split:${accountId}`,
    environment: "mock",
    approvalThreshold: 2,
    createdByUserId: userId,
    createdAt: "2026-11-01T10:00:00.000Z",
    approvals: [] as ReturnType<typeof approval>[],
  };
}

function workspace(proposals = [proposal()]) {
  return {
    balanceSource: "ledger-derived internal",
    custodyStatus: "not on-chain verified",
    asset: {
      assetId: "mock:near:usdc",
      symbol: "Mock USDC",
      decimals: 6,
      environment: "mock",
    },
    accounts: [
      {
        id: accountId,
        organizationId: orgId,
        assetId: "mock:near:usdc",
        code: "TREASURY",
        name: "Treasury cash",
        accountType: "ASSET",
        normalSide: "DEBIT",
        postedBalanceAtomic: "12500000000",
        reservedBalanceAtomic: "2500000000",
        availableBalanceAtomic: "10000000000",
        version: 3,
      },
    ],
    activePolicy: {
      id: "77777777-7777-4777-8777-777777777777",
      organizationId: orgId,
      version: 1,
      digest: policyDigest,
      rules: { approvalThreshold: 2 },
    },
    proposals,
    splitTemplate: {
      shares: [
        { recipientId: "payroll", basisPoints: 5000 },
        { recipientId: "operations", basisPoints: 3000 },
        { recipientId: "partner_distributions", basisPoints: 2000 },
      ],
      remainderRecipientId: "payroll",
      recipientCommitment: "e".repeat(64),
    },
  };
}

test.beforeEach(async ({ context, page }) => {
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
});

test("treasury labels internal balances honestly and sends only split inputs", async ({
  page,
}) => {
  const data = workspace([]);
  let requestBody: Record<string, unknown> | null = null;
  await page.route(`**/api/coffer/v1/orgs/${orgId}/treasury`, (route) =>
    route.fulfill({ status: 200, json: data }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/treasury/split-proposals`,
    async (route) => {
      requestBody = await route.request().postDataJSON();
      expect(route.request().headers()["x-csrf-token"]).toBe("c".repeat(43));
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      await route.fulfill({ status: 201, json: proposal() });
    },
  );

  await page.goto("/treasury");
  await expect(page.getByText("ledger-derived internal")).toBeVisible();
  await expect(page.getByText("Not verified on-chain")).toBeVisible();
  await expect(page.getByText("10,000", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Propose split" }).click();
  await page.getByLabel("Total · Mock USDC").fill("10000.000001");
  await page.getByRole("button", { name: "Submit for approval" }).click();

  expect(requestBody).toMatchObject({
    sourceAccountId: accountId,
    amountAtomic: "10000000001",
  });
  expect(Object.keys(requestBody ?? {}).sort()).toEqual([
    "amountAtomic",
    "expiresAt",
    "sourceAccountId",
  ]);
});

test("the same verified person cannot satisfy quorum twice", async ({
  page,
}) => {
  const current = proposal({
    approvals: [approval(userId, "owner.testnet")],
  });
  await page.route(`**/api/coffer/v1/orgs/${orgId}/treasury`, (route) =>
    route.fulfill({ status: 200, json: workspace([current]) }),
  );

  await page.goto("/approvals");
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.getByText("owner.testnet", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "You approved this revision" }),
  ).toBeDisabled();
  await expect(page.getByText(/records no new wallet signature/)).toBeVisible();
});

test("editing creates a clean revision and exposes the immutable diff", async ({
  page,
}) => {
  const old = proposal({
    status: "APPROVED",
    approvals: [
      approval(userId, "owner.testnet"),
      approval("88888888-8888-4888-8888-888888888888", "alex.testnet"),
    ],
  });
  const revised = proposal({
    id: revisionId,
    revision: 2,
    amountAtomic: "9000000000",
    authorizedMaxAtomic: "9000000000",
    instructionDigest: "9".repeat(64),
    approvals: [],
    createdAt: "2026-11-01T12:00:00.000Z",
  });
  let data = workspace([old]);
  await page.route(`**/api/coffer/v1/orgs/${orgId}/treasury`, (route) =>
    route.fulfill({ status: 200, json: data }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/treasury/split-proposals/${proposalId}/revisions`,
    async (route) => {
      data = workspace([{ ...old, status: "SUPERSEDED" }, revised]);
      await route.fulfill({ status: 201, json: revised });
    },
  );

  await page.goto("/approvals");
  await page.getByRole("button", { name: "Edit as new revision" }).click();
  await page.getByLabel("Total · Mock USDC").fill("9000");
  await page.getByRole("button", { name: "Create revision" }).click();

  await expect(page.getByText("Immutable revision diff")).toBeVisible();
  await expect(page.getByText("0 / 2")).toBeVisible();
  await expect(page.getByText(/approvals cannot carry forward/)).toBeVisible();
});

test("expired proposals cannot be approved", async ({ page }) => {
  const expired = proposal({ expiresAt: "2020-01-01T00:00:00.000Z" });
  await page.route(`**/api/coffer/v1/orgs/${orgId}/treasury`, (route) =>
    route.fulfill({ status: 200, json: workspace([expired]) }),
  );

  await page.goto("/approvals");
  await expect(
    page.getByText("EXPIRED", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve as/ })).toHaveCount(0);
});

test("final RPC failure remains visible and side-effect free", async ({
  page,
}) => {
  const approved = proposal({
    status: "APPROVED",
    approvals: [
      approval("88888888-8888-4888-8888-888888888888", "alex.testnet"),
      approval("99999999-9999-4999-8999-999999999999", "sam.testnet"),
    ],
  });
  await page.route(`**/api/coffer/v1/orgs/${orgId}/treasury`, (route) =>
    route.fulfill({ status: 200, json: workspace([approved]) }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/treasury/split-proposals/${proposalId}/reserve`,
    (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );

  await page.goto("/approvals");
  await expect(page.getByText("2 / 2")).toBeVisible();
  await page.getByRole("button", { name: "Verify & reserve funds" }).click();
  await expect(
    page.getByText(
      "Final policy evidence could not be verified. No funds were reserved.",
    ),
  ).toBeVisible();
});

test("policy denial leaves the proposed split uncreated", async ({ page }) => {
  await page.route(`**/api/coffer/v1/orgs/${orgId}/treasury`, (route) =>
    route.fulfill({ status: 200, json: workspace([]) }),
  );
  await page.route(
    `**/api/coffer/v1/orgs/${orgId}/treasury/split-proposals`,
    (route) => route.fulfill({ status: 403, json: { error: "policy denied" } }),
  );

  await page.goto("/treasury");
  await page.getByRole("button", { name: "Propose split" }).click();
  await page.getByLabel("Total · Mock USDC").fill("10000");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(
    page.getByText("The active policy or your role denied this action."),
  ).toBeVisible();
  await expect(
    page.getByText("No treasury split has been proposed."),
  ).toBeVisible();
});
