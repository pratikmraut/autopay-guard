import AxeBuilder from "@axe-core/playwright";
import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";

import { signInRealIdentity } from "./milestone5-real-support";

const webOrigin = "http://localhost:3000";
const identityOrigin = "http://localhost:8081";
const mailOrigin = "http://localhost:8025";
const realmAdmin = `${identityOrigin}/admin/realms/autopay-guard`;
const enabled = process.env.AUTH_SELF_REGISTRATION_ENABLED === "true";

test.skip(!enabled, "The local signup rehearsal must be explicitly enabled.");
// Recovery URLs and credentials must not be retained in retry trace artifacts.
test.use({ trace: "off" });
test.setTimeout(240_000);

interface RehearsalAccount {
  email: string;
  password: string;
  page: Page;
  enrolled: boolean;
  consumedMessages: Set<string>;
}

test("registers verified private accounts, recovers access and denies cross-account reads", async ({
  browser,
  request,
}, testInfo) => {
  expect(testInfo.project.use.baseURL).toBe(webOrigin);
  expect(process.env.AUTOPAY_GUARD_RUNTIME_MODE).toBe("LOCAL");
  expect(process.env.AUTH_KEYCLOAK_ISSUER).toBe(
    `${identityOrigin}/realms/autopay-guard`,
  );
  const contextOptions = {
    ...(testInfo.project.name === "mobile-chromium"
      ? devices["Pixel 7"]
      : devices["Desktop Chrome"]),
    baseURL: webOrigin,
  };
  const contexts = await Promise.all([
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
  ]);
  const accounts: RehearsalAccount[] = [];
  for (const context of contexts.slice(0, 2)) {
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(30_000);
    accounts.push({
      email: `portfolio-e2e-${randomUUID()}@autopayguard.local`,
      password: randomBytes(24).toString("hex"),
      page: await context.newPage(),
      enrolled: false,
      consumedMessages: new Set(),
    });
  }
  const adminPage = await contexts[2].newPage();
  adminPage.setDefaultTimeout(20_000);
  try {
    for (const account of accounts) {
      await registerAndEnroll(account, request);
      await account.page
        .getByLabel("Workspace name")
        .fill("Portfolio rehearsal workspace");
      await account.page
        .getByRole("checkbox", { name: /I confirm that I am 18 or older/ })
        .check();
      await account.page
        .getByRole("checkbox", {
          name: /I have read and accept the privacy notice/,
        })
        .check();
      await account.page
        .getByRole("button", { name: "Create my workspace" })
        .click();
      await expectPageLocation(account.page, webOrigin, /^\/dashboard/);
      await account.page
        .getByRole("button", { name: /Portfolio rehearsal workspace INR/ })
        .click();
      await expect(
        account.page.getByRole("heading", { name: /Good to see you/ }),
      ).toBeVisible();
    }

    const owner = accounts[0].page;
    const other = accounts[1].page;
    const ownerHouseholds = await (
      await bff(owner, "GET", "/v1/households")
    ).json();
    const otherHouseholds = await (
      await bff(other, "GET", "/v1/households")
    ).json();
    expect(ownerHouseholds.items).toHaveLength(1);
    expect(otherHouseholds.items).toHaveLength(1);
    const householdId = ownerHouseholds.items[0].id as string;
    expect(otherHouseholds.items[0].id).not.toBe(householdId);
    expect(
      (
        await bff(owner, "GET", `/v1/households/${householdId}/members`)
      ).status(),
    ).toBe(200);
    expect(
      (
        await bff(other, "GET", `/v1/households/${householdId}/members`)
      ).status(),
    ).toBe(404);
    expect((await bff(owner, "GET", "/v1/admin/audit-events")).status()).toBe(
      403,
    );

    await owner.goto(`${webOrigin}/commitments/new?householdId=${householdId}`);
    await owner
      .getByLabel("Display name")
      .fill("Portfolio private test commitment");
    await owner
      .getByRole("combobox", { name: /^Category/ })
      .selectOption("SUBSCRIPTION");
    await owner.getByLabel("Fixed amount").fill("250");
    await owner
      .getByRole("button", { name: "Add recurring commitment" })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Portfolio private test commitment" }),
    ).toBeVisible();
    const commitmentId = new URL(owner.url()).pathname.split("/").at(-1);
    expect(commitmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (await bff(other, "GET", `/v1/commitments/${commitmentId}`)).status(),
    ).toBe(404);
    const summaryPath = `/v1/dashboard/summary?householdId=${householdId}&month=2026-09`;
    expect((await bff(owner, "GET", summaryPath)).status()).toBe(200);
    expect((await bff(other, "GET", summaryPath)).status()).toBe(404);

    // Password recovery is provider-owned; the application never handles it.
    await owner.getByRole("button", { name: "Sign out", exact: true }).click();
    await expectPageLocation(owner, webOrigin, /^\/$/);
    await owner.goto(`${webOrigin}/signin?callbackUrl=%2Fdashboard`);
    await owner.getByRole("button", { name: "Continue securely" }).click();
    await expectPageLocation(
      owner,
      identityOrigin,
      /^\/realms\/autopay-guard\//,
    );
    await owner.getByRole("link", { name: /Forgot password/i }).click();
    await owner
      .getByRole("textbox", { name: /Username|Email/i })
      .fill(accounts[0].email);
    await owner.getByRole("button", { name: /Submit/i }).click();
    const resetLink = await captureActionLink(request, accounts[0]);
    await privateStage("open the password-recovery link", () =>
      owner.goto(resetLink),
    );
    const newPassword = randomBytes(24).toString("hex");
    await privateStage("submit the replacement password", async () => {
      await owner.locator('input[name="password-new"]').fill(newPassword);
      await owner.locator('input[name="password-confirm"]').fill(newPassword);
      await owner.getByRole("button", { name: /Submit/i }).click();
    });
    await expect(owner.locator('input[name="password-new"]')).not.toBeVisible();
    const previousPassword = accounts[0].password;
    accounts[0].password = newPassword;
    // Force a fresh login so an existing provider session cannot mask a broken
    // reset. The old password must fail before the new password succeeds.
    await owner.context().clearCookies();
    await owner.goto(`${webOrigin}/signin?callbackUrl=%2Fdashboard`);
    await owner.getByRole("button", { name: "Continue securely" }).click();
    await owner.locator('input[name="username"]').fill(accounts[0].email);
    await privateStage(
      "attempt sign-in with the previous password",
      async () => {
        await owner.locator('input[name="password"]').fill(previousPassword);
        await owner
          .getByRole("button", { name: "Sign In", exact: true })
          .click();
      },
    );
    await expect(
      owner.getByText("Invalid username or password.", { exact: true }),
    ).toBeVisible();
    await privateStage("sign in with the replacement password", async () => {
      await owner.locator('input[name="password"]').fill(newPassword);
      await owner.getByRole("button", { name: "Sign In", exact: true }).click();
    });
    await expectPageLocation(owner, webOrigin, /^\/dashboard/);
    const afterRecovery = await (
      await bff(owner, "GET", "/v1/households")
    ).json();
    expect(afterRecovery.items[0].id).toBe(householdId);
    expect(
      (await bff(owner, "GET", `/v1/commitments/${commitmentId}`)).status(),
    ).toBe(200);

    const issues = await new AxeBuilder({ page: owner }).analyze();
    expect(
      issues.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  } finally {
    // Use the actual deletion workflow only for accounts created by this test.
    const cleanupFailures: string[] = [];
    if (accounts.some((account) => account.enrolled)) {
      await privateStage("sign in for local privacy cleanup", () =>
        signInRealIdentity(adminPage, "privacyAdmin", "/admin/privacy"),
      );
    }
    for (const account of accounts) {
      try {
        if (account.enrolled) {
          if ((await bff(account.page, "GET", "/v1/me")).status() === 401) {
            await account.page.goto(
              `${webOrigin}/signin?callbackUrl=%2Fdashboard`,
            );
            await account.page
              .getByRole("button", { name: "Continue securely" })
              .click();
            await expect
              .poll(
                () => {
                  const url = new URL(account.page.url());
                  return (
                    url.origin === identityOrigin ||
                    (url.origin === webOrigin && url.pathname === "/dashboard")
                  );
                },
                {
                  timeout: 30_000,
                  message:
                    "Cleanup sign-in reaches the local provider or dashboard",
                },
              )
              .toBe(true);
            if (new URL(account.page.url()).origin === identityOrigin) {
              await account.page
                .locator('input[name="username"]')
                .fill(account.email);
              await account.page
                .locator('input[name="password"]')
                .fill(account.password);
              await account.page
                .getByRole("button", { name: "Sign In", exact: true })
                .click();
            }
            await expectPageLocation(account.page, webOrigin, /^\/dashboard/);
          }
          const deletion = await bff(
            account.page,
            "POST",
            "/v1/privacy/requests",
            { requestType: "DELETION" },
            { "idempotency-key": randomUUID() },
          );
          expect(deletion.status()).toBe(201);
          const pending = await deletion.json();
          const execution = await bff(
            adminPage,
            "POST",
            `/v1/admin/privacy/requests/${pending.id}/execute`,
            undefined,
            {
              "if-match": deletion.headers().etag,
              "idempotency-key": randomUUID(),
            },
          );
          expect(execution.status()).toBe(200);
          expect((await execution.json()).status).toBe("EXECUTED");
          expect((await bff(account.page, "GET", "/v1/me")).status()).toBe(403);
        }
        await removeRehearsalIdentity(request, account.email);
      } catch {
        cleanupFailures.push(
          "A generated local rehearsal account could not be completely cleaned up.",
        );
      }
    }
    await Promise.all(contexts.map((context) => context.close()));
    expect(cleanupFailures).toEqual([]);
  }
});

async function registerAndEnroll(
  account: RehearsalAccount,
  request: APIRequestContext,
) {
  const page = account.page;
  await page.goto(`${webOrigin}/signup`);
  await page.getByRole("button", { name: "Create account securely" }).click();
  await expectPageLocation(page, identityOrigin, /^\/realms\/autopay-guard\//);
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(account.email);
  await page
    .getByRole("textbox", { name: "First name", exact: true })
    .fill("Portfolio");
  await page
    .getByRole("textbox", { name: "Last name", exact: true })
    .fill("Rehearsal");
  // Pinned Keycloak can collect the password before or after verification.
  if (await page.locator('input[name="password"]').isVisible()) {
    await privateStage("fill the registration password", async () => {
      await page.locator('input[name="password"]').fill(account.password);
      await page
        .locator('input[name="password-confirm"]')
        .fill(account.password);
    });
  }
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const verificationLink = await captureActionLink(request, account);
  await privateStage("open the email-verification link", () =>
    page.goto(verificationLink),
  );
  if (await page.locator('input[name="password-new"]').isVisible()) {
    await privateStage("submit the verified identity password", async () => {
      await page.locator('input[name="password-new"]').fill(account.password);
      await page
        .locator('input[name="password-confirm"]')
        .fill(account.password);
      await page.getByRole("button", { name: /Submit/i }).click();
    });
  }
  await expectPageLocation(page, webOrigin, /^\/enroll$/);
  const unprovisioned = await bff(page, "GET", "/v1/me");
  expect(unprovisioned.status()).toBe(403);
  expect((await unprovisioned.json()).code).toBe("ACCOUNT_ENROLLMENT_REQUIRED");
  const create = page.getByRole("button", { name: "Create my app account" });
  await expect(create).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I confirm that I am 18 or older/ })
    .check();
  await page
    .getByRole("checkbox", {
      name: /I have read and accept the privacy notice/,
    })
    .check();
  const enrollmentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/bff/v1/account/enrollment",
  );
  await create.click();
  expect((await enrollmentResponse).status()).toBe(200);
  account.enrolled = true;
  await expectPageLocation(page, webOrigin, /^\/onboarding$/);
}

async function captureActionLink(
  request: APIRequestContext,
  account: RehearsalAccount,
) {
  return privateStage("capture a local verification or recovery message", () =>
    captureActionLinkPrivately(request, account),
  );
}

async function captureActionLinkPrivately(
  request: APIRequestContext,
  account: RehearsalAccount,
) {
  let link: string | undefined;
  await expect(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/messages?start=0&limit=500`,
    );
    expect(response.status()).toBe(200);
    const { messages } = await response.json();
    for (const message of messages as Array<{
      ID: string;
      To: Array<{ Address: string }>;
    }>) {
      if (
        account.consumedMessages.has(message.ID) ||
        !message.To.some(({ Address }) => Address === account.email)
      )
        continue;
      const detailResponse = await request.get(
        `${mailOrigin}/api/v1/message/${encodeURIComponent(message.ID)}`,
      );
      const detail = await detailResponse.json();
      const candidate = (detail.Text as string).match(
        /http:\/\/localhost:8081\/realms\/autopay-guard\/login-actions\/action-token\?[^\s<>]+/,
      )?.[0];
      if (candidate) {
        const parsed = new URL(candidate.replaceAll("&amp;", "&"));
        expect(parsed.origin).toBe(identityOrigin);
        expect(parsed.username).toBe("");
        expect(parsed.password).toBe("");
        account.consumedMessages.add(message.ID);
        link = parsed.toString();
        break;
      }
    }
    expect(Boolean(link)).toBe(true);
  }).toPass({ timeout: 30_000 });
  return link!;
}

// A failed Playwright URL assertion normally prints the complete current URL.
// Compare only these non-secret fields; provider action keys stay in memory.
async function expectPageLocation(page: Page, origin: string, path: RegExp) {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return { origin: url.origin, path: url.pathname };
    })
    .toEqual({ origin, path: expect.stringMatching(path) });
}

// Navigation/fill/request errors can embed action links, passwords or headers.
// Preserve the failing stage, but never attach the original private diagnostic.
async function privateStage<T>(
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch {
    throw new Error(
      `Local signup rehearsal could not ${stage}. Private provider diagnostics omitted.`,
    );
  }
}

function bff(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
) {
  return page.request.fetch(`${webOrigin}/api/bff${path}`, {
    method,
    data,
    headers: { origin: webOrigin, ...headers },
  });
}

async function removeRehearsalIdentity(
  request: APIRequestContext,
  email: string,
) {
  if (!/^portfolio-e2e-[0-9a-f-]{36}@autopayguard\.local$/.test(email))
    throw new Error("Refusing non-rehearsal identity cleanup.");
  const tokenResponse = await request.post(
    `${identityOrigin}/realms/master/protocol/openid-connect/token`,
    {
      form: {
        client_id: "admin-cli",
        grant_type: "password",
        username: process.env.KEYCLOAK_ADMIN_USERNAME!,
        password: process.env.KEYCLOAK_ADMIN_PASSWORD!,
      },
    },
  );
  expect(tokenResponse.status()).toBe(200);
  const { access_token: accessToken } = await tokenResponse.json();
  const headers = { authorization: `Bearer ${accessToken}` };
  const usersResponse = await request.get(
    `${realmAdmin}/users?username=${encodeURIComponent(email)}&exact=true`,
    { headers },
  );
  expect(usersResponse.status()).toBe(200);
  const users = await usersResponse.json();
  for (const user of users) {
    expect(user.username).toBe(email);
    expect(user.email).toBe(email);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (
        await request.delete(`${realmAdmin}/users/${user.id}`, { headers })
      ).status(),
    ).toBe(204);
  }
}
