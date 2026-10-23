import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const webOrigin = "http://localhost:3000";
const identityOrigin = "http://localhost:8081";
const demoEmail = "demo@autopayguard.local";
const registrationEnabled =
  process.env.AUTH_SELF_REGISTRATION_ENABLED === "true";
const localRehearsal =
  process.env.AUTOPAY_GUARD_RUNTIME_MODE === "LOCAL" &&
  process.env.AUTH_URL === webOrigin &&
  process.env.AUTH_KEYCLOAK_ISSUER ===
    `${identityOrigin}/realms/autopay-guard` &&
  process.env.E2E_USER_EMAIL === demoEmail &&
  Boolean(process.env.E2E_USER_PASSWORD?.trim());

test.skip(
  !localRehearsal,
  "Branded login requires the exact localhost stack and existing fake demo credentials.",
);
// Provider URLs contain state/action keys. Real local credentials must never
// appear in automatic screenshots, traces, recordings, or failure diagnostics.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);

test.beforeEach(async ({ page }, testInfo) => {
  expect(testInfo.project.use.baseURL).toBe(webOrigin);
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(30_000);
});

test.afterEach(async ({ page }) => {
  // Playwright can attach an automatic error-context DOM snapshot even when
  // tracing is disabled. Clear provider action links before fixture teardown.
  try {
    if (!page.isClosed()) {
      await page.goto("about:blank", { timeout: 5_000 });
    }
  } catch {
    // Do not replace the original failure with private navigation diagnostics.
  }
});

test("brands local sign-in, errors, registration policy and recovery without creating accounts", async ({
  page,
}, testInfo) => {
  await openProviderLogin(page);
  await expect(page.locator("#kc-page-title")).toHaveText(
    "Sign in to your account",
  );
  await expectBrandedProvider(page);
  await expect(page.locator("#password")).toHaveValue("");
  await expect(page.locator("#kc-login")).toHaveCSS(
    "background-color",
    "rgb(18, 63, 52)",
  );
  // Capture only the rendered document, before any password or authentication
  // attempt. Page screenshots do not include the browser's provider URL bar.
  await page.screenshot({
    path: testInfo.outputPath("branded-login-clean.png"),
    fullPage: true,
  });
  await expectNoSeriousAxe(page);

  const password = page.locator("#password");
  await password.fill("Fictional visibility check only");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await password.fill("");

  // A unique nonexistent .local identity exercises provider validation without
  // risking failed-login lockout of the existing demo or any other account.
  await page
    .locator("#username")
    .fill(`brand-ui-missing-${randomUUID()}@autopayguard.local`);
  await password.fill("Fictional nonexistent account only");
  await privateStage("check the provider's invalid-login form", async () => {
    await page.locator("#kc-login").click();
    await expect(
      page.getByText("Invalid username or password.", { exact: true }),
    ).toBeVisible();
  });
  await expectBrandedProvider(page);
  await expectNoSeriousAxe(page);

  await openProviderLogin(page);
  if (registrationEnabled) {
    await privateStage("open the provider registration form", () =>
      page.getByRole("link", { name: "Register", exact: true }).click(),
    );
    await expect(page.locator("#kc-register-form")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Email", exact: true }),
    ).toHaveValue("");
    await expectBrandedProvider(page);
    await expectNoSeriousAxe(page);
  } else {
    await expect(
      page.getByRole("link", { name: "Register", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${webOrigin}/signup`);
    await expect(
      page.getByRole("heading", { name: "Registration is not open" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account securely" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open demo workspace" }),
    ).toHaveAttribute("href", "/signin");
    await expectNoSeriousAppAxe(page);
  }

  await openProviderLogin(page);
  await privateStage("open the provider recovery form", () =>
    page.getByRole("link", { name: /Forgot password/i }).click(),
  );
  await expect(page.locator("#kc-reset-password-form")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /Username|Email/i }),
  ).toHaveValue("");
  await expectBrandedProvider(page);
  await expectNoSeriousAxe(page);
  // Neither registration nor recovery is submitted: no identities, emails,
  // password changes, workspace records, or commitments are created here.
});

test("prefills the existing local demo identity and completes normal OIDC login", async ({
  page,
}) => {
  if (!registrationEnabled) {
    await page.goto(webOrigin);
    await expect(
      page.getByRole("link", { name: "Open demo workspace" }),
    ).toHaveAttribute("href", "/signin");
    await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
  }
  await page.goto(`${webOrigin}/signin?callbackUrl=%2Fdashboard`);
  if (!registrationEnabled) {
    await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
    await expect(
      page.getByText("No new account is needed. Registration is closed."),
    ).toBeVisible();
    await expect(page.locator('main button[type="submit"]').first()).toHaveText(
      /Use local demo account/,
    );
  }
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Try sample without signing in" }),
  ).toHaveAttribute("href", "/demo");
  await privateStage("start the local demo sign-in", () =>
    page.getByRole("button", { name: "Use local demo account" }).click(),
  );
  await expectProviderLocation(page);

  // Compare only safe public values and booleans, never log full OIDC URLs or
  // the opaque state, nonce, challenge, callback code, or session cookies.
  const authorization = new URL(page.url());
  expect({
    loginHint: authorization.searchParams.get("login_hint"),
    prompt: authorization.searchParams.get("prompt"),
    responseType: authorization.searchParams.get("response_type"),
    clientId: authorization.searchParams.get("client_id"),
    callback: authorization.searchParams.get("redirect_uri"),
    challengeMethod: authorization.searchParams.get("code_challenge_method"),
    hasState: Boolean(authorization.searchParams.get("state")),
    hasChallenge: Boolean(authorization.searchParams.get("code_challenge")),
    hasNonce: Boolean(authorization.searchParams.get("nonce")),
  }).toEqual({
    loginHint: demoEmail,
    prompt: "login",
    responseType: "code",
    clientId: "autopay-guard-web",
    callback: `${webOrigin}/api/auth/callback/keycloak`,
    challengeMethod: "S256",
    hasState: true,
    hasChallenge: true,
    hasNonce: true,
  });
  await expect(page.locator("#username")).toHaveValue(demoEmail);
  await expect(page.locator("#password")).toHaveValue("");
  await expectBrandedProvider(page);

  await privateStage(
    "authenticate the existing local demo account",
    async () => {
      await page.locator("#password").fill(process.env.E2E_USER_PASSWORD!);
      await page.locator("#kc-login").click();
      await expect
        .poll(
          () => {
            const current = new URL(page.url());
            return (
              current.origin === webOrigin && current.pathname === "/dashboard"
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);
    },
  );

  await privateStage("read the authenticated demo profile", async () => {
    const response = await page.request.get(`${webOrigin}/api/bff/v1/me`);
    expect(response.status()).toBe(200);
    const profile = await response.json();
    expect({ email: profile.email, displayName: profile.displayName }).toEqual({
      email: demoEmail,
      displayName: "Demo User",
    });
  });
  await privateStage("keep every browser session alias closed", async () => {
    for (const path of [
      "/api/auth/session",
      "/api/auth/session/",
      "/api/auth/session//",
      "/api/auth//session",
      "/api/auth/%73ession",
      "/api/auth/session%2F",
    ]) {
      const response = await page.request.get(`${webOrigin}${path}`);
      expect(response.status()).toBe(404);
      expect((await response.body()).byteLength).toBe(0);
    }
  });
  await privateStage("sign the demo test session out", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect
      .poll(() => {
        const current = new URL(page.url());
        return current.origin === webOrigin && current.pathname === "/";
      })
      .toBe(true);
    const response = await page.request.get(`${webOrigin}/api/bff/v1/me`);
    expect(response.status()).toBe(401);
  });
});

async function openProviderLogin(page: Page) {
  await page.goto(`${webOrigin}/signin?callbackUrl=%2Fdashboard`);
  await privateStage("open the local sign-in provider", () =>
    page.getByRole("button", { name: "Continue securely" }).click(),
  );
  await expectProviderLocation(page);
  await expect(page.locator("#kc-form-login")).toBeVisible();
}

async function expectProviderLocation(page: Page) {
  await expect
    .poll(
      () => {
        const current = new URL(page.url());
        return { origin: current.origin, path: current.pathname };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      origin: identityOrigin,
      path: expect.stringMatching(/^\/realms\/autopay-guard\//),
    });
}

async function expectBrandedProvider(page: Page) {
  await expectProviderLocation(page);
  await expect(page.locator("#kc-header-wrapper")).toHaveText("AutoPay Guard");
  await expect(
    page.locator('link[rel="stylesheet"][href$="/css/autopay-guard.css"]'),
  ).toHaveCount(1);
  await expect(page.locator("body")).toHaveCSS("color", "rgb(16, 34, 29)");
  await expect(page.locator(".card-pf")).toHaveCSS(
    "background-color",
    "rgb(255, 254, 250)",
  );
  await expect(
    page.getByRole("link", { name: "Open sample demo" }),
  ).toHaveAttribute("href", `${webOrigin}/demo`);
  await expect(
    page.getByRole("link", { name: "Use local demo account" }),
  ).toHaveAttribute("href", `${webOrigin}/signin`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function expectNoSeriousAxe(page: Page) {
  await expect(page.locator('script[src$="/js/tab-order.js"]')).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator("[tabindex]").evaluateAll((elements) =>
        elements
          .filter(
            (element) => element instanceof HTMLElement && element.tabIndex > 0,
          )
          .map((element) => ({
            id: element.id,
            tag: element.tagName,
            index: (element as HTMLElement).tabIndex,
          })),
      ),
    )
    .toEqual([]);
  await expectNoSeriousAppAxe(page);
}

async function expectNoSeriousAppAxe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  // Raw violation nodes can contain provider action links. Keep only rule IDs.
  expect(
    result.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
}

async function privateStage<T>(
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch {
    throw new Error(
      `Branded login could not ${stage}. Private diagnostics omitted.`,
    );
  }
}
