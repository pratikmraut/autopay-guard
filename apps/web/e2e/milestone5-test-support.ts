import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, type TestInfo } from "@playwright/test";

type FakeIdentity =
  | "USER"
  | "GUIDE_ADMIN"
  | "PRIVACY_ADMIN"
  | "AUDIT_READ"
  | "SUPPORT_READ";

const identityEnvironment: Record<
  FakeIdentity,
  { username: string[]; password: string[] }
> = {
  USER: {
    username: ["E2E_USER_EMAIL", "KEYCLOAK_FAKE_USER_USERNAME"],
    password: ["E2E_USER_PASSWORD", "KEYCLOAK_FAKE_USER_PASSWORD"],
  },
  GUIDE_ADMIN: {
    username: [
      "KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME",
      "KEYCLOAK_FAKE_ADMIN_USERNAME",
    ],
    password: [
      "KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD",
      "KEYCLOAK_FAKE_ADMIN_PASSWORD",
    ],
  },
  PRIVACY_ADMIN: {
    username: ["KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME"],
    password: ["KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD"],
  },
  AUDIT_READ: {
    username: ["KEYCLOAK_FAKE_AUDIT_READ_USERNAME"],
    password: ["KEYCLOAK_FAKE_AUDIT_READ_PASSWORD"],
  },
  SUPPORT_READ: {
    username: ["KEYCLOAK_FAKE_SUPPORT_USERNAME"],
    password: ["KEYCLOAK_FAKE_SUPPORT_PASSWORD"],
  },
};

export const fixtureIds = {
  household: "10000000-0000-4000-8000-000000000501",
  ownerUser: "10000000-0000-4000-8000-000000000502",
  ownerMember: "10000000-0000-4000-8000-000000000503",
  memberUser: "10000000-0000-4000-8000-000000000504",
  member: "10000000-0000-4000-8000-000000000505",
  invitationPending: "10000000-0000-4000-8000-000000000506",
  invitationExpired: "10000000-0000-4000-8000-000000000507",
  privacyReady: "10000000-0000-4000-8000-000000000508",
  privacyBlocked: "10000000-0000-4000-8000-000000000509",
  privacyExpired: "10000000-0000-4000-8000-000000000510",
  privacyFailed: "10000000-0000-4000-8000-000000000511",
  privacyExecuted: "10000000-0000-4000-8000-000000000512",
  guide: "40000000-0000-4000-8000-000000000020",
  draft: "10000000-0000-4000-8000-000000000514",
  feedback: "10000000-0000-4000-8000-000000000515",
  audit: "10000000-0000-4000-8000-000000000516",
  correlation: "10000000-0000-4000-8000-000000000517",
  supportGrant: "10000000-0000-4000-8000-000000000518",
  sharedCommitment: "10000000-0000-4000-8000-000000000522",
} as const;

export const fixedInstant = "2026-07-28T10:30:00Z";
export const futureInstant = "2026-07-28T10:45:00Z";
export const expiredInstant = "2026-07-28T10:29:59Z";
export const oneTimeCode = "A".repeat(43);

export const ownerHousehold = {
  id: fixtureIds.household,
  name: "M5 Playwright household",
  ownerUserId: fixtureIds.ownerUser,
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: fixedInstant,
  updatedAt: fixedInstant,
  accessRole: "OWNER",
  canManage: true,
} as const;

export async function signInAs(
  page: Page,
  identity: FakeIdentity,
  returnTo: string,
) {
  const environment = identityEnvironment[identity];
  const username = firstEnvironment(environment.username);
  const password = firstEnvironment(environment.password);
  assertFakeIdentity(username, environment.username[0] ?? "username");

  await page.goto(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
  const applicationOrigin = new URL(page.url()).origin;
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL(
    (url) =>
      url.origin === applicationOrigin && !url.pathname.startsWith("/signin"),
    { timeout: 30_000 },
  );
  await page.goto(returnTo);
  await expect(page).toHaveURL(returnTo);
}

export async function expectNoSeriousAxe(page: Page) {
  await expect(page).toHaveTitle(/\S+/);
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) =>
      impact ? ["serious", "critical"].includes(impact) : false,
    ),
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(
    Math.max(dimensions.body, dimensions.document),
    `${context} overflowed the ${dimensions.viewport}px viewport`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

export async function expectNoOverflowAtTwoHundredPercent(
  page: Page,
  testInfo: TestInfo,
  context: string,
) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setPageScaleFactor", {
      pageScaleFactor: 2,
    });
    await expectNoHorizontalOverflow(
      page,
      `${context} at 200% page scale in ${testInfo.project.name}`,
    );
  } finally {
    await session.send("Emulation.setPageScaleFactor", {
      pageScaleFactor: 1,
    });
    await session.detach();
  }
}

export async function expectEmptyBrowserStorage(page: Page) {
  const browserStorage = await page.evaluate(() => {
    const entries = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? "";
        return [key, storage.getItem(key)] as const;
      });
    return {
      local: entries(localStorage),
      session: entries(sessionStorage),
    };
  });
  expect(browserStorage).toEqual({ local: [], session: [] });
}

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  await route.fulfill({
    status,
    contentType:
      status >= 400 ? "application/problem+json" : "application/json",
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function fulfillProblem(
  route: Route,
  status: number,
  detail: string,
) {
  await fulfillJson(
    route,
    {
      type: "about:blank",
      title: "Request rejected",
      status,
      detail,
    },
    status,
  );
}

function firstEnvironment(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(
    `${names.join(" or ")} is required for the fake-local Playwright suite.`,
  );
}

function assertFakeIdentity(username: string, source: string) {
  if (
    !username.endsWith("@autopayguard.local") &&
    !username.endsWith(".example.test")
  ) {
    throw new Error(`${source} must identify a seeded fake-local user.`);
  }
}
