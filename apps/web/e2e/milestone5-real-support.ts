import AxeBuilder from "@axe-core/playwright";
import {
  devices,
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type RealIdentity =
  | "owner"
  | "member"
  | "foreign"
  | "guideAdmin"
  | "privacyAdmin"
  | "auditRead"
  | "supportRead"
  | "deletion";

export interface RealSession {
  context: BrowserContext;
  page: Page;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  ownerUserId: string;
  defaultCurrency: string;
  timezone: string;
  accessRole: "OWNER" | "MEMBER";
  canManage: boolean;
  createdAt: string;
}

export interface ApiOptions {
  data?: unknown;
  expectedStatus?: number | number[];
  headers?: Record<string, string>;
}

const acknowledgement = "I_ACKNOWLEDGE_LOCAL_FAKE_M5_ACCEPTANCE";
export const canonicalBaseUrl = "http://localhost:3000";
const canonicalIssuer = "http://localhost:8081/realms/autopay-guard";
export const disposableGuideId = "40000000-0000-4000-8000-000000000020";
export const disposableOidcSubject = "88888888-8888-4888-8888-888888888888";
export const deletionTombstoneHash = createHash("sha256")
  .update(
    `autopay-guard/deletion-tombstone/v1:${disposableOidcSubject}`,
    "utf8",
  )
  .digest("hex");
export const canonicalNames = {
  shared: "M2 Fixture StreamBox Demo",
  privateCanary: "M2 Fixture CloudNest Demo",
  fitClub: "M2 Fixture FitClub Demo",
  variable: "M2 Fixture Monsoon Utility Demo",
} as const;

const expectedUsernames: Record<RealIdentity, string> = {
  owner: "demo@autopayguard.local",
  member: "member@autopayguard.local",
  foreign: "foreign@autopayguard.local",
  guideAdmin: "admin@autopayguard.local",
  privacyAdmin: "privacy-admin@autopayguard.local",
  auditRead: "audit-reader@autopayguard.local",
  supportRead: "support@autopayguard.local",
  deletion: "deletion@autopayguard.local",
};

const identityEnvironment: Record<RealIdentity, [string, string]> = {
  owner: ["KEYCLOAK_FAKE_USER_USERNAME", "KEYCLOAK_FAKE_USER_PASSWORD"],
  member: ["KEYCLOAK_FAKE_MEMBER_USERNAME", "KEYCLOAK_FAKE_MEMBER_PASSWORD"],
  foreign: ["KEYCLOAK_FAKE_FOREIGN_USERNAME", "KEYCLOAK_FAKE_FOREIGN_PASSWORD"],
  guideAdmin: [
    "KEYCLOAK_FAKE_GUIDE_ADMIN_USERNAME",
    "KEYCLOAK_FAKE_GUIDE_ADMIN_PASSWORD",
  ],
  privacyAdmin: [
    "KEYCLOAK_FAKE_PRIVACY_ADMIN_USERNAME",
    "KEYCLOAK_FAKE_PRIVACY_ADMIN_PASSWORD",
  ],
  auditRead: [
    "KEYCLOAK_FAKE_AUDIT_READ_USERNAME",
    "KEYCLOAK_FAKE_AUDIT_READ_PASSWORD",
  ],
  supportRead: [
    "KEYCLOAK_FAKE_SUPPORT_USERNAME",
    "KEYCLOAK_FAKE_SUPPORT_PASSWORD",
  ],
  deletion: [
    "KEYCLOAK_FAKE_DELETION_USERNAME",
    "KEYCLOAK_FAKE_DELETION_PASSWORD",
  ],
};

const repositoryRoot = resolve(__dirname, "../../..");
const envFile = join(repositoryRoot, ".env");
const lockPath = join(
  tmpdir(),
  "autopay-guard-milestone5-live-acceptance.lock",
);
const m5IdempotencyRecordKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[A-Z_]{1,40}:[0-9a-f]{64}$/;

export function realUiEnabled() {
  return process.env.M5_REAL_OIDC_UI === "true";
}

export function validateRealUiEnvironment(baseUrl: string) {
  if (process.env.M5_LIVE_ACCEPTANCE_ACK !== acknowledgement) {
    throw new Error(
      `Set M5_LIVE_ACCEPTANCE_ACK=${acknowledgement} before the guarded real-OIDC browser suite.`,
    );
  }
  if (baseUrl !== canonicalBaseUrl) {
    throw new Error(
      `The real-OIDC browser suite refuses non-canonical base URL ${baseUrl}.`,
    );
  }
  requireExactEnvironment("COMPOSE_PROJECT_NAME", "autopay-guard");
  requireExactEnvironment("AUTH_URL", canonicalBaseUrl);
  requireExactEnvironment("AUTH_KEYCLOAK_ISSUER", canonicalIssuer);
  requireExactEnvironment("POSTGRES_DB", "autopay_guard");
  requireExactEnvironment("POSTGRES_USER", "autopay_guard_admin");
  for (const identity of Object.keys(identityEnvironment) as RealIdentity[]) {
    credentials(identity);
  }
}

export async function acquireRealUiLock() {
  const token = randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      throw new Error(
        `Another M5 live verifier may be running. Check it before removing the stale lock at ${lockPath}.`,
      );
    }
    throw error;
  }
  await handle.writeFile(
    JSON.stringify({
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      suite: "playwright-real-oidc",
    }),
  );
  await handle.close();
  return async () => {
    const current = await readFile(lockPath, "utf8").catch(() => null);
    if (!current) {
      return;
    }
    const owner = JSON.parse(current) as { token?: string };
    if (owner.token === token) {
      await rm(lockPath, { force: true });
    }
  };
}

export async function createRealSession(
  browser: Browser,
  identity: RealIdentity,
  testInfo: TestInfo,
  returnTo: string,
): Promise<RealSession> {
  const context = await browser.newContext(contextOptions(testInfo));
  const page = await context.newPage();
  try {
    await signInRealIdentity(page, identity, returnTo);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function signInRealIdentity(
  page: Page,
  identity: RealIdentity,
  returnTo: string,
) {
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const { username, password } = credentials(identity);
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`, {
    waitUntil: "load",
  });
  const signInActionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === canonicalBaseUrl &&
      new URL(response.url()).pathname === "/signin",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Continue securely" }).click();
  const signInActionResponse = await signInActionResponsePromise;
  try {
    await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  } catch (cause) {
    const headers = signInActionResponse.headers();
    throw new Error(
      `The local sign-in action returned HTTP ${signInActionResponse.status()} with ${headers["content-type"] ?? "no content type"}, action redirect ${headers["x-action-redirect"] ? "present" : "absent"}, and location ${headers.location ? "present" : "absent"}.`,
      { cause },
    );
  }
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL(
    (url) =>
      url.origin === canonicalBaseUrl &&
      !url.pathname.startsWith("/signin") &&
      !url.pathname.startsWith("/api/auth"),
    { timeout: 30_000 },
  );
  await page.goto(returnTo, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(returnTo);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(returnTo);
  const me = await apiJson<Record<string, unknown>>(page, "GET", "/v1/me");
  expect(me.email).toBe(username);
}

export async function attemptDeletedIdentitySignIn(
  browser: Browser,
  testInfo: TestInfo,
) {
  const context = await browser.newContext(contextOptions(testInfo));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const { username, password } = credentials("deletion");
  try {
    await page.goto("/signin?callbackUrl=%2Fsettings%2Fprivacy", {
      waitUntil: "load",
    });
    await page.getByRole("button", { name: "Continue securely" }).click();
    await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
    await page.waitForLoadState("domcontentloaded");
    await api(page, "GET", "/v1/me", { expectedStatus: [401, 403] });
    if (new URL(page.url()).pathname === "/settings/privacy") {
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Privacy controls unavailable" }),
      ).toBeVisible();
    } else {
      expect(new URL(page.url()).pathname).not.toBe("/settings/privacy");
    }
    await expectBrowserStorageEmpty(page);
  } finally {
    await context.close();
  }
}

export async function signOutAndProtect(page: Page, protectedPath: string) {
  await expectBrowserStorageEmpty(page);
  const signOut = page.getByRole("button", { name: "Sign out" });
  if (!(await signOut.isVisible().catch(() => false))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(signOut).toBeVisible({ timeout: 15_000 });
  await signOut.click();
  await expect(page).toHaveURL("/");
  await expectBrowserStorageEmpty(page);
  await page.goto(protectedPath);
  await expect(page).toHaveURL("/signin?callbackUrl=%2Fdashboard");
}

export async function api(
  page: Page,
  method: string,
  path: string,
  options: ApiOptions = {},
) {
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];
  const response = await page.request.fetch(
    `${canonicalBaseUrl}/api/bff${path}`,
    {
      method,
      data: options.data,
      headers: {
        accept: "application/json, application/problem+json",
        origin: canonicalBaseUrl,
        ...(options.data === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(options.headers ?? {}),
      },
    },
  );
  if (!expected.includes(response.status())) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `${method} ${path.split("?")[0]} returned HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
}

export async function apiJson<T extends object>(
  page: Page,
  method: string,
  path: string,
  options: ApiOptions = {},
) {
  const response = await api(page, method, path, options);
  return responseJson<T>(response);
}

export async function responseJson<T extends object>(response: APIResponse) {
  const body = (await response.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("A real-OIDC BFF response was not a JSON object.");
  }
  return body as T;
}

export function etag(response: APIResponse, version: number) {
  const expected = `"${version}"`;
  expect(response.headers().etag).toBe(expected);
  return expected;
}

export function idempotencyKey(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export async function expectRealUiQuality(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  await expectRealUiAxe(page, label);
  await expectRealUiLayoutQuality(page, testInfo, label);
}

export async function expectRealUiAxe(page: Page, label: string) {
  const analysis = new AxeBuilder({ page }).analyze();
  void analysis.catch(() => undefined);
  let analysisTimedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      analysis,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          analysisTimedOut = true;
          reject(
            new Error(`${label} Axe analysis timed out after 45 seconds.`),
          );
        }, 45_000);
      }),
    ]);
    expect(
      result.violations.filter(({ impact }) =>
        impact ? ["serious", "critical"].includes(impact) : false,
      ),
      `${label} has serious or critical Axe violations`,
    ).toEqual([]);
  } catch (error) {
    if (analysisTimedOut) {
      await page
        .reload({ timeout: 15_000, waitUntil: "domcontentloaded" })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function expectRealUiLayoutQuality(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  if (testInfo.project.name === "mobile-chromium") {
    const undersized = await page
      .locator(
        [
          "#main-content button:visible",
          "#main-content a.primary-link:visible",
          "#main-content a.secondary-link--button:visible",
          "#main-content input:not([type='checkbox']):not([type='radio']):visible",
          "#main-content textarea:visible",
          "#main-content select:visible",
          "#main-content label:has(input[type='checkbox']:visible)",
          "#main-content label:has(input[type='radio']:visible)",
        ].join(","),
      )
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const box = element.getBoundingClientRect();
          return box.width + 0.5 < 44 || box.height + 0.5 < 44
            ? [
                {
                  tag: element.tagName.toLowerCase(),
                  text:
                    element.getAttribute("aria-label") ??
                    element.textContent?.trim().slice(0, 80) ??
                    "",
                  width: box.width,
                  height: box.height,
                },
              ]
            : [];
        }),
      );
    expect(
      undersized,
      `${label} has actionable touch targets below 44 CSS pixels`,
    ).toEqual([]);
  }
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(
    Math.max(dimensions.body, dimensions.document),
    `${label} overflowed ${dimensions.viewport}px in ${testInfo.project.name}`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
  const originalViewport = page.viewportSize();
  if (!originalViewport) {
    throw new Error(`${label} has no emulated viewport for reflow testing.`);
  }
  const reflowWidths = [
    320,
    Math.max(320, Math.floor(originalViewport.width / 2)),
  ];
  for (const width of new Set(reflowWidths)) {
    await page.setViewportSize({ width, height: originalViewport.height });
    const reflowed = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(
      Math.max(reflowed.body, reflowed.document),
      `${label} overflowed at a ${width}px CSS viewport in ${testInfo.project.name}`,
    ).toBeLessThanOrEqual(reflowed.viewport + 1);
  }
  await page.setViewportSize(originalViewport);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const zoomed = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(
      Math.max(zoomed.body, zoomed.document),
      `${label} overflowed at 200% in ${testInfo.project.name}`,
    ).toBeLessThanOrEqual(zoomed.viewport + 1);
  } finally {
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await session.detach();
  }
}

export async function expectBrowserStorageEmpty(page: Page) {
  const storage = await page.evaluate(() => {
    const entries = (value: Storage) =>
      Array.from({ length: value.length }, (_, index) => {
        const key = value.key(index) ?? "";
        return [key, value.getItem(key)] as const;
      });
    return {
      local: entries(localStorage),
      session: entries(sessionStorage),
    };
  });
  expect(storage).toEqual({ local: [], session: [] });
}

export async function assertLocalFixtureAdministration() {
  const identity = await postgresScalar(
    "SELECT current_database() || '|' || current_user",
  );
  if (identity !== "autopay_guard|autopay_guard_admin") {
    throw new Error(
      "Refusing fixture administration against an unexpected PostgreSQL database.",
    );
  }
  const reserved = await postgresScalar(
    `
      SELECT COUNT(*)
      FROM cancellation_guide_versions
      WHERE guide_id = :'guide_id'::uuid
        AND version = 1
        AND status = 'PUBLISHED'
    `,
    { guide_id: disposableGuideId },
  );
  if (reserved !== "1") {
    throw new Error("The reserved fictional guide baseline is missing.");
  }
}

export async function resolveCanonicalHousehold(page: Page) {
  const collection = await apiJson<{ items: HouseholdSummary[] }>(
    page,
    "GET",
    "/v1/households",
  );
  const household = [...collection.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
  if (
    !household ||
    household.defaultCurrency !== "INR" ||
    household.accessRole !== "OWNER" ||
    household.canManage !== true
  ) {
    throw new Error("The canonical fake owner INR household is unavailable.");
  }
  const commitments = await listCommitments(page, household.id);
  const canonical = commitments.filter(
    ({ displayName, status }) =>
      status === "ACTIVE" &&
      Object.values(canonicalNames).includes(
        displayName as (typeof canonicalNames)[keyof typeof canonicalNames],
      ),
  );
  if (
    canonical.length !== 4 ||
    new Set(canonical.map(({ displayName }) => displayName)).size !== 4
  ) {
    throw new Error(
      "The oldest fake owner household does not contain the four canonical commitments.",
    );
  }
  return household;
}

export async function restoreCanonicalHousehold(
  page: Page,
  household: HouseholdSummary,
) {
  const invitations = await apiJson<{
    items: Array<{ id: string; status: string; version: number }>;
  }>(page, "GET", `/v1/households/${household.id}/invitations`);
  for (const invitation of invitations.items) {
    if (invitation.status === "PENDING") {
      await api(
        page,
        "DELETE",
        `/v1/households/${household.id}/invitations/${invitation.id}`,
        {
          expectedStatus: [204, 404],
          headers: { "if-match": `"${invitation.version}"` },
        },
      );
    }
  }
  const members = await apiJson<{
    items: Array<{
      id: string;
      role: string;
      status: string;
      version: number;
    }>;
  }>(page, "GET", `/v1/households/${household.id}/members`);
  for (const member of members.items) {
    if (member.role === "MEMBER" && member.status === "ACTIVE") {
      await api(
        page,
        "DELETE",
        `/v1/households/${household.id}/members/${member.id}`,
        {
          expectedStatus: [204, 404],
          headers: { "if-match": `"${member.version}"` },
        },
      );
    }
  }
  const commitments = await listCommitments(page, household.id);
  for (const commitment of commitments) {
    if (
      !Object.values(canonicalNames).includes(
        commitment.displayName as (typeof canonicalNames)[keyof typeof canonicalNames],
      ) ||
      (commitment.visibility === "PRIVATE" &&
        commitment.responsibleMemberId === null)
    ) {
      continue;
    }
    const current = await getCommitment(page, commitment.id);
    await api(page, "PATCH", `/v1/commitments/${commitment.id}/sharing`, {
      headers: { "if-match": current.etag },
      data: { visibility: "PRIVATE", responsibleMemberId: null },
    });
  }
}

export async function listCommitments(page: Page, householdId: string) {
  const collection = await apiJson<{
    items: Array<{
      id: string;
      displayName: string;
      visibility: "PRIVATE" | "HOUSEHOLD";
      responsibleMemberId: string | null;
      status: string;
      version: number;
    }>;
    nextCursor: string | null;
  }>(
    page,
    "GET",
    `/v1/commitments?${new URLSearchParams({
      householdId,
      includeArchived: "false",
      limit: "100",
    }).toString()}`,
  );
  return collection.items;
}

export function uniqueCommitment(
  commitments: Awaited<ReturnType<typeof listCommitments>>,
  displayName: string,
) {
  const matches = commitments.filter(
    (item) => item.displayName === displayName && item.status === "ACTIVE",
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one active commitment named ${displayName}.`);
  }
  return matches[0]!;
}

export async function getCommitment(page: Page, commitmentId: string) {
  const response = await api(page, "GET", `/v1/commitments/${commitmentId}`);
  const body = await responseJson<{
    id: string;
    version: number;
    visibility: "PRIVATE" | "HOUSEHOLD";
    responsibleMemberId: string | null;
  }>(response);
  return { body, etag: etag(response, body.version) };
}

export async function resetMemberPrivacyFixture() {
  await resetPrivacyFixtureForEmail(expectedUsernames.member);
}

export async function restoreMemberTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error("The member cleanup timezone is not a valid IANA zone.");
  }
  const email = expectedUsernames.member;
  const current = await postgresScalar(
    "SELECT timezone FROM users WHERE email = :'email'",
    { email },
  );
  if (current !== timezone) {
    await postgresExecute(
      `
        UPDATE users
        SET timezone = :'timezone',
            updated_at = clock_timestamp()
        WHERE email = :'email'
      `,
      { email, timezone },
    );
  }
  const restored = await postgresScalar(
    "SELECT timezone FROM users WHERE email = :'email'",
    { email },
  );
  if (restored !== timezone) {
    throw new Error("The member app timezone could not be restored.");
  }
}

export async function resetPrivacyFixtureForEmail(email: string) {
  assertDisposableEmail(email);
  await postgresExecute(
    `
      BEGIN;

      DELETE FROM privacy_export_artifacts
      WHERE request_id IN (
        SELECT r.id
        FROM privacy_requests r
        JOIN users u ON u.id = r.requester_user_id
        WHERE u.email = :'email'
      );

      DELETE FROM privacy_request_event_locks
      WHERE request_id IN (
        SELECT r.id
        FROM privacy_requests r
        JOIN users u ON u.id = r.requester_user_id
        WHERE u.email = :'email'
      );

      DELETE FROM privacy_request_events
      WHERE request_id IN (
        SELECT r.id
        FROM privacy_requests r
        JOIN users u ON u.id = r.requester_user_id
        WHERE u.email = :'email'
      );

      DELETE FROM privacy_requests
      WHERE requester_user_id = (
        SELECT id FROM users WHERE email = :'email'
      );

      DELETE FROM consent_event_locks
      WHERE user_id = (SELECT id FROM users WHERE email = :'email');
      DELETE FROM consent_events
      WHERE user_id = (SELECT id FROM users WHERE email = :'email');
      DELETE FROM privacy_notice_acknowledgement_locks
      WHERE user_id = (SELECT id FROM users WHERE email = :'email');
      DELETE FROM privacy_notice_acknowledgements
      WHERE user_id = (SELECT id FROM users WHERE email = :'email');
      DELETE FROM m5_idempotency_records
      WHERE actor_user_id = (SELECT id FROM users WHERE email = :'email');

      COMMIT;
    `,
    { email },
  );
}

export async function resetRateEventsForIdentities(identities: RealIdentity[]) {
  for (const identity of identities) {
    const email = expectedUsernames[identity];
    const subject = await postgresScalar(
      "SELECT oidc_subject FROM users WHERE email = :'email'",
      { email },
    );
    if (!subject) {
      continue;
    }
    const actorKey = createHash("sha256")
      .update(`autopay-guard/operation-rate/v1:${subject}`, "utf8")
      .digest("hex");
    await postgresExecute(
      "DELETE FROM operation_rate_events WHERE actor_key = :'actor_key'",
      { actor_key: actorKey },
    );
  }
}

export async function assertM6CleanBaseline(householdId: string) {
  requireUuid(householdId, "M6 household");
  const snapshot = await postgresScalar(
    `
      SELECT
        (SELECT COUNT(*) FROM commitment_import_jobs) || '|' ||
        (SELECT COUNT(*) FROM commitment_import_items) || '|' ||
        (SELECT COUNT(*) FROM commitment_import_item_errors) || '|' ||
        (SELECT COUNT(*) FROM recurring_commitments WHERE source = 'CSV') || '|' ||
        (SELECT COUNT(*) FROM m5_idempotency_records
          WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
        (SELECT COUNT(*) FROM operation_rate_events
          WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
        (SELECT COUNT(*) FROM operation_rate_locks
          WHERE operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
        (SELECT COUNT(*) FROM audit_events
          WHERE resource_type = 'IMPORT_JOB') || '|' ||
        (SELECT COUNT(*) FROM audit_event_locks
          WHERE resource_type = 'IMPORT_JOB') || '|' ||
        (SELECT COUNT(*) FROM recurring_commitments
          WHERE household_id = :'household_id'::uuid
            AND status = 'ACTIVE') || '|' ||
        (SELECT COUNT(*) FROM recurring_commitments
          WHERE household_id = :'household_id'::uuid
            AND status = 'ACTIVE'
            AND display_name IN (
              'M2 Fixture Monsoon Utility Demo',
              'M2 Fixture FitClub Demo',
              'M2 Fixture CloudNest Demo',
              'M2 Fixture StreamBox Demo'
            ))
    `,
    { household_id: householdId },
  );
  if (snapshot !== "0|0|0|0|0|0|0|0|0|4|4") {
    throw new Error(
      `The M6 clean-baseline invariant failed (snapshot ${snapshot}).`,
    );
  }
}

export async function cleanupM6ImportFixtures({
  householdId,
  importJobIds,
  runToken,
}: {
  householdId: string;
  importJobIds: string[];
  runToken: string;
}) {
  requireUuid(householdId, "M6 household");
  if (!/^[a-p]{8}$/.test(runToken)) {
    throw new Error("The M6 cleanup token was invalid.");
  }

  const exactJobIds = new Set<string>();
  for (const importJobId of importJobIds) {
    requireUuid(importJobId, "M6 import job");
    exactJobIds.add(importJobId);
  }
  if (exactJobIds.size > 3) {
    throw new Error("The M6 cleanup scope exceeded three import jobs.");
  }

  const discoveredJobIds = await postgresUuidList(
    `
      SELECT DISTINCT j.id
      FROM commitment_import_jobs j
      JOIN commitment_import_items i ON i.import_job_id = j.id
      JOIN users u ON u.id = j.owner_user_id
      WHERE j.household_id = :'household_id'::uuid
        AND lower(u.email) = 'demo@autopayguard.local'
        AND i.name LIKE '%' || :'run_token' || '%'
      ORDER BY j.id
    `,
    {
      household_id: householdId,
      run_token: runToken,
    },
  );
  for (const importJobId of discoveredJobIds) {
    exactJobIds.add(importJobId);
  }
  if (exactJobIds.size > 3) {
    throw new Error("The M6 cleanup discovery exceeded three import jobs.");
  }

  for (const importJobId of exactJobIds) {
    const ownership = await postgresScalar(
      `
        SELECT
          COUNT(*) || '|' ||
          COUNT(*) FILTER (
            WHERE j.household_id = :'household_id'::uuid
              AND lower(u.email) = 'demo@autopayguard.local'
          )
        FROM commitment_import_jobs j
        JOIN users u ON u.id = j.owner_user_id
        WHERE j.id = :'import_job_id'::uuid
      `,
      {
        household_id: householdId,
        import_job_id: importJobId,
      },
    );
    if (ownership !== "0|0" && ownership !== "1|1") {
      throw new Error("M6 cleanup refused a foreign import job.");
    }

    await postgresExecute(
      `
        BEGIN;

        DELETE FROM audit_event_locks
        WHERE id IN (
          SELECT id
          FROM audit_events
          WHERE resource_type = 'IMPORT_JOB'
            AND resource_id = :'import_job_id'::uuid
        );

        DELETE FROM audit_events
        WHERE resource_type = 'IMPORT_JOB'
          AND resource_id = :'import_job_id'::uuid;

        DELETE FROM m5_idempotency_records
        WHERE resource_id = :'import_job_id'::uuid
          AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');

        UPDATE commitment_import_items
        SET selected = NULL,
            created_commitment_id = NULL,
            updated_at = clock_timestamp()
        WHERE import_job_id = :'import_job_id'::uuid;

        DELETE FROM recurring_commitments
        WHERE import_job_id = :'import_job_id'::uuid
          AND household_id = :'household_id'::uuid
          AND source = 'CSV';

        DELETE FROM commitment_import_jobs
        WHERE id = :'import_job_id'::uuid
          AND household_id = :'household_id'::uuid
          AND owner_user_id = (
            SELECT id
            FROM users
            WHERE lower(email) = 'demo@autopayguard.local'
          );

        COMMIT;
      `,
      {
        household_id: householdId,
        import_job_id: importJobId,
      },
    );
  }

  const ownerSubject = await postgresScalar(
    `
      SELECT oidc_subject
      FROM users
      WHERE lower(email) = 'demo@autopayguard.local'
    `,
  );
  if (!ownerSubject) {
    throw new Error("The canonical M6 owner subject was not found.");
  }
  const actorKey = createHash("sha256")
    .update(`autopay-guard/operation-rate/v1:${ownerSubject}`, "utf8")
    .digest("hex");
  await postgresExecute(
    `
      BEGIN;
      DELETE FROM operation_rate_events
      WHERE actor_key = :'actor_key'
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');
      DELETE FROM operation_rate_locks
      WHERE actor_key = :'actor_key'
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');
      COMMIT;
    `,
    { actor_key: actorKey },
  );
}

export async function resetDisposableGuideFixture() {
  await postgresExecute(
    `
      BEGIN;

      UPDATE cancellation_guide_catalog_state
      SET current_published_version = 1,
          state = 'ACTIVE',
          optimistic_version = 0,
          updated_at = (
            SELECT published_at
            FROM cancellation_guide_versions
            WHERE guide_id = :'guide_id'::uuid AND version = 1
          )
      WHERE guide_id = :'guide_id'::uuid;

      DELETE FROM guide_lifecycle_event_locks
      WHERE id IN (
        SELECT id FROM guide_lifecycle_events
        WHERE guide_id = :'guide_id'::uuid AND guide_version > 1
      );
      DELETE FROM guide_lifecycle_events
      WHERE guide_id = :'guide_id'::uuid AND guide_version > 1;
      DELETE FROM cancellation_published_target_locks
      WHERE guide_id = :'guide_id'::uuid AND guide_version > 1;
      DELETE FROM cancellation_published_step_locks
      WHERE guide_id = :'guide_id'::uuid AND guide_version > 1;
      DELETE FROM cancellation_published_version_locks
      WHERE guide_id = :'guide_id'::uuid AND version > 1;
      DELETE FROM cancellation_guide_draft_states
      WHERE guide_id = :'guide_id'::uuid AND guide_version > 1;
      DELETE FROM cancellation_guide_steps
      WHERE guide_id = :'guide_id'::uuid AND guide_version > 1;
      DELETE FROM cancellation_guide_versions
      WHERE guide_id = :'guide_id'::uuid AND version > 1;

      COMMIT;
    `,
    { guide_id: disposableGuideId },
  );
  const state = await postgresScalar(
    `
      SELECT s.state || '|' || s.current_published_version || '|' ||
             s.optimistic_version || '|' || COUNT(v.version)
      FROM cancellation_guide_catalog_state s
      JOIN cancellation_guide_versions v ON v.guide_id = s.guide_id
      WHERE s.guide_id = :'guide_id'::uuid
      GROUP BY s.state, s.current_published_version, s.optimistic_version
    `,
    { guide_id: disposableGuideId },
  );
  if (state !== "ACTIVE|1|0|1") {
    throw new Error("The disposable guide did not return to its baseline.");
  }
}

export async function resetDisposableDeletionFixture() {
  await postgresExecute(
    `
      DELETE FROM deletion_tombstones
      WHERE subject_hash = :'subject_hash'
    `,
    { subject_hash: deletionTombstoneHash },
  );
  const remaining = await postgresScalar(
    `
      SELECT COUNT(*) FROM deletion_tombstones
      WHERE subject_hash = :'subject_hash'
    `,
    { subject_hash: deletionTombstoneHash },
  );
  if (remaining !== "0") {
    throw new Error("The disposable deletion tombstone could not be reset.");
  }
}

export async function backdateInvitation(invitationId: string) {
  requireUuid(invitationId, "invitation");
  const changed = await postgresScalar(
    `
      WITH boundary AS (SELECT clock_timestamp() AS expires_at),
      changed AS (
        UPDATE household_invitations i
        SET created_at = boundary.expires_at - INTERVAL '1 day',
            expires_at = boundary.expires_at,
            updated_at = boundary.expires_at - INTERVAL '1 day'
        FROM boundary
        WHERE i.id = :'id'::uuid AND i.status = 'PENDING'
        RETURNING i.id
      )
      SELECT COUNT(*) FROM changed
    `,
    { id: invitationId },
  );
  if (changed !== "1") {
    throw new Error("The invitation expiry fixture could not be advanced.");
  }
}

export async function backdateSupportGrant(grantId: string) {
  requireUuid(grantId, "support grant");
  const changed = await postgresScalar(
    `
      WITH boundary AS (SELECT clock_timestamp() AS expires_at),
      changed AS (
        UPDATE support_diagnostic_grants g
        SET created_at = boundary.expires_at - INTERVAL '15 minutes',
            expires_at = boundary.expires_at,
            updated_at = boundary.expires_at - INTERVAL '15 minutes'
        FROM boundary
        WHERE g.id = :'id'::uuid AND g.status = 'ACTIVE'
        RETURNING g.id
      )
      SELECT COUNT(*) FROM changed
    `,
    { id: grantId },
  );
  if (changed !== "1") {
    throw new Error("The support expiry fixture could not be advanced.");
  }
}

export async function backdateExport(requestId: string) {
  requireUuid(requestId, "export request");
  const changed = await postgresScalar(
    `
      WITH changed AS (
        UPDATE privacy_export_artifacts
        SET expires_at = generated_at + INTERVAL '1 second'
        WHERE request_id = :'id'::uuid
          AND payload IS NOT NULL
          AND purged_at IS NULL
        RETURNING request_id
      )
      SELECT COUNT(*) FROM changed
    `,
    { id: requestId },
  );
  if (changed !== "1") {
    throw new Error("The export expiry fixture could not be advanced.");
  }
}

export async function assertDisposableDeletionState(
  userId: string,
  exportRequestId: string,
) {
  requireUuid(userId, "disposable user");
  requireUuid(exportRequestId, "export request");
  const state = await postgresScalar(
    `
      SELECT
        (SELECT COUNT(*) FROM users WHERE id = :'user_id'::uuid) || '|' ||
        (SELECT COUNT(*) FROM deletion_tombstones
         WHERE subject_hash = :'subject_hash') || '|' ||
        (SELECT COUNT(*) FROM privacy_export_artifacts
         WHERE request_id = :'request_id'::uuid)
    `,
    {
      user_id: userId,
      subject_hash: deletionTombstoneHash,
      request_id: exportRequestId,
    },
  );
  if (state !== "0|1|0") {
    throw new Error(
      "Disposable deletion did not remove the local user/export and retain exactly one tombstone.",
    );
  }
  const tombstone = await postgresScalar(
    `
      SELECT
        (subject_hash = :'subject_hash')::text || '|' ||
        (execution_id IS NOT NULL)::text || '|' ||
        (created_at IS NOT NULL)::text
      FROM deletion_tombstones
      WHERE subject_hash = :'subject_hash'
    `,
    { subject_hash: deletionTombstoneHash },
  );
  if (tombstone !== "true|true|true") {
    throw new Error("The deletion tombstone exceeded its minimal shape.");
  }
}

export async function cleanupPrivacyRequest(requestId: string | null) {
  if (!requestId) {
    return;
  }
  requireUuid(requestId, "privacy request");
  await postgresExecute(
    `
      BEGIN;
      DELETE FROM privacy_export_artifacts
      WHERE request_id = :'id'::uuid;
      DELETE FROM privacy_request_event_locks
      WHERE request_id = :'id'::uuid;
      DELETE FROM privacy_request_events
      WHERE request_id = :'id'::uuid;
      DELETE FROM privacy_requests
      WHERE id = :'id'::uuid;
      COMMIT;
    `,
    { id: requestId },
  );
}

export async function cleanupGuideFeedback(feedbackId: string | null) {
  if (!feedbackId) {
    return;
  }
  requireUuid(feedbackId, "guide feedback");
  await postgresExecute(
    `
      BEGIN;
      DELETE FROM guide_feedback_reviews
      WHERE feedback_id = :'id'::uuid;
      DELETE FROM cancellation_guide_feedback
      WHERE id = :'id'::uuid;
      COMMIT;
    `,
    { id: feedbackId },
  );
}

export async function privacyRequestIdsForEmail(email: string) {
  if (
    email !== expectedUsernames.owner &&
    email !== expectedUsernames.member &&
    email !== expectedUsernames.foreign &&
    email !== expectedUsernames.deletion
  ) {
    throw new Error("Privacy baseline refused an unexpected identity.");
  }
  return postgresUuidList(
    `
      SELECT r.id
      FROM privacy_requests r
      JOIN users u ON u.id = r.requester_user_id
      WHERE u.email = :'email'
      ORDER BY r.id
    `,
    { email },
  );
}

export async function consentEventIdsForEmail(email: string) {
  if (email !== expectedUsernames.owner) {
    throw new Error("Owner consent baseline refused an unexpected identity.");
  }
  return postgresUuidList(
    `
      SELECT e.id
      FROM consent_events e
      JOIN users u ON u.id = e.user_id
      WHERE u.email = :'email'
      ORDER BY e.id
    `,
    { email },
  );
}

export async function cleanupNewConsentEventsForEmail(
  email: string,
  baselineIds: string[],
) {
  const baseline = new Set(baselineIds);
  for (const eventId of await consentEventIdsForEmail(email)) {
    if (baseline.has(eventId)) {
      continue;
    }
    await postgresExecute(
      `
        BEGIN;
        DELETE FROM m5_idempotency_records
        WHERE resource_id = :'id'::uuid
          AND actor_user_id = (SELECT id FROM users WHERE email = :'email');
        DELETE FROM consent_event_locks WHERE id = :'id'::uuid;
        DELETE FROM consent_events WHERE id = :'id'::uuid;
        COMMIT;
      `,
      { email, id: eventId },
    );
  }
}

export async function noticeAcknowledgementIdsForEmail(email: string) {
  if (email !== expectedUsernames.owner) {
    throw new Error("Owner notice baseline refused an unexpected identity.");
  }
  return postgresUuidList(
    `
      SELECT a.id
      FROM privacy_notice_acknowledgements a
      JOIN users u ON u.id = a.user_id
      WHERE u.email = :'email'
      ORDER BY a.id
    `,
    { email },
  );
}

export async function cleanupNewNoticeAcknowledgementsForEmail(
  email: string,
  baselineIds: string[],
) {
  const baseline = new Set(baselineIds);
  for (const acknowledgementId of await noticeAcknowledgementIdsForEmail(
    email,
  )) {
    if (baseline.has(acknowledgementId)) {
      continue;
    }
    await postgresExecute(
      `
        BEGIN;
        DELETE FROM m5_idempotency_records
        WHERE resource_id = :'id'::uuid
          AND actor_user_id = (SELECT id FROM users WHERE email = :'email');
        DELETE FROM privacy_notice_acknowledgement_locks
        WHERE id = :'id'::uuid;
        DELETE FROM privacy_notice_acknowledgements
        WHERE id = :'id'::uuid;
        COMMIT;
      `,
      { email, id: acknowledgementId },
    );
  }
}

export async function cleanupNewPrivacyRequestsForEmail(
  email: string,
  baselineIds: string[],
) {
  const baseline = new Set(baselineIds);
  for (const requestId of await privacyRequestIdsForEmail(email)) {
    if (!baseline.has(requestId)) {
      await cleanupPrivacyRequest(requestId);
    }
  }
}

export async function guideFeedbackIds() {
  return postgresUuidList(
    "SELECT id FROM cancellation_guide_feedback ORDER BY id",
  );
}

export async function cleanupNewGuideFeedback(baselineIds: string[]) {
  const baseline = new Set(baselineIds);
  for (const feedbackId of await guideFeedbackIds()) {
    if (!baseline.has(feedbackId)) {
      await cleanupGuideFeedback(feedbackId);
    }
  }
}

export async function supportGrantIdsForHousehold(householdId: string) {
  requireUuid(householdId, "household");
  return postgresUuidList(
    `
      SELECT id
      FROM support_diagnostic_grants
      WHERE household_id = :'household_id'::uuid
      ORDER BY id
    `,
    { household_id: householdId },
  );
}

export async function cleanupNewSupportGrants(
  householdId: string,
  baselineIds: string[],
) {
  const baseline = new Set(baselineIds);
  for (const grantId of await supportGrantIdsForHousehold(householdId)) {
    if (baseline.has(grantId)) {
      continue;
    }
    requireUuid(grantId, "support grant");
    await postgresExecute(
      `
        BEGIN;
        UPDATE support_diagnostic_grants
        SET status = 'REVOKED',
            active_key = NULL,
            revoked_at = clock_timestamp(),
            optimistic_version = optimistic_version + 1,
            updated_at = clock_timestamp()
        WHERE id = :'id'::uuid
          AND status = 'ACTIVE';
        DELETE FROM support_diagnostic_grants
        WHERE id = :'id'::uuid;
        COMMIT;
      `,
      { id: grantId },
    );
  }
}

export async function auditEventIds() {
  return postgresUuidList("SELECT id FROM audit_events ORDER BY id");
}

export async function cleanupNewAuditEvents(baselineIds: string[]) {
  const baseline = new Set(baselineIds);
  for (const id of baseline) {
    requireUuid(id, "audit baseline");
  }
  for (const eventId of await auditEventIds()) {
    if (baseline.has(eventId)) {
      continue;
    }
    await postgresExecute(
      `
        BEGIN;
        DELETE FROM audit_event_locks WHERE id = :'id'::uuid;
        DELETE FROM audit_events WHERE id = :'id'::uuid;
        COMMIT;
      `,
      { id: eventId },
    );
  }
  const remaining = (await auditEventIds()).filter((id) => !baseline.has(id));
  if (remaining.length > 0) {
    throw new Error("Run-created audit events survived fixture cleanup.");
  }
}

export async function m5IdempotencyRecordKeys() {
  const output = await postgresCommand(
    `
      SELECT actor_user_id::text || ':' || operation || ':' || key_hash
      FROM m5_idempotency_records
      ORDER BY actor_user_id, operation, key_hash
    `,
    {},
  );
  const values = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => !m5IdempotencyRecordKeyPattern.test(value))) {
    throw new Error("An M5 idempotency fixture key was invalid.");
  }
  return values;
}

export async function cleanupNewM5IdempotencyRecords(baselineKeys: string[]) {
  const baseline = new Set(baselineKeys);
  for (const key of baseline) {
    requireM5IdempotencyRecordKey(key);
  }
  for (const key of await m5IdempotencyRecordKeys()) {
    if (baseline.has(key)) {
      continue;
    }
    const [actorUserId, operation, keyHash] =
      requireM5IdempotencyRecordKey(key);
    await postgresExecute(
      `
        DELETE FROM m5_idempotency_records
        WHERE actor_user_id = :'actor_user_id'::uuid
          AND operation = :'operation'
          AND key_hash = :'key_hash'
      `,
      {
        actor_user_id: actorUserId,
        operation,
        key_hash: keyHash,
      },
    );
  }
  const remaining = (await m5IdempotencyRecordKeys()).filter(
    (key) => !baseline.has(key),
  );
  if (remaining.length > 0) {
    throw new Error(
      "Run-created M5 idempotency records survived fixture cleanup.",
    );
  }
}

async function postgresUuidList(
  sql: string,
  variables: Record<string, string> = {},
) {
  const output = await postgresCommand(sql, variables);
  const values = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const value of values) {
    requireUuid(value, "fixture baseline");
  }
  return values;
}

export async function postgresScalar(
  sql: string,
  variables: Record<string, string> = {},
) {
  return (await postgresCommand(sql, variables)).trim();
}

async function postgresExecute(
  sql: string,
  variables: Record<string, string> = {},
) {
  await postgresCommand(sql, variables);
}

async function postgresCommand(sql: string, variables: Record<string, string>) {
  const args = [
    "compose",
    "--project-directory",
    repositoryRoot,
    "--env-file",
    envFile,
    "--file",
    join(repositoryRoot, "compose.yaml"),
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username",
    requiredEnvironment("POSTGRES_USER"),
    "--dbname",
    requiredEnvironment("POSTGRES_DB"),
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set",
    "ON_ERROR_STOP=1",
  ];
  for (const [name, value] of Object.entries(variables).sort()) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !/^[A-Za-z0-9_.:@-]+$/.test(value)) {
      throw new Error("A local PostgreSQL fixture variable was invalid.");
    }
    args.push("--set", `${name}=${value}`);
  }
  return runPostgresCommand(args, sql);
}

async function runPostgresCommand(args: string[], sql: string) {
  return new Promise<string>((resolveCommand, rejectCommand) => {
    const child = spawn("docker", args, {
      cwd: repositoryRoot,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const maximumOutputBytes = 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error("The local PostgreSQL fixture command timed out."));
    }, 30_000);

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      rejectCommand(error);
    };

    child.once("error", fail);
    child.stdin.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") {
        child.kill();
        fail(error);
      }
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes) {
        child.kill();
        fail(
          new Error("The local PostgreSQL fixture output exceeded its limit."),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stderrBytes += chunk.length;
      if (stderrBytes > maximumOutputBytes) {
        child.kill();
        fail(
          new Error("The local PostgreSQL fixture error exceeded its limit."),
        );
        return;
      }
      stderrChunks.push(chunk);
    });
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        rejectCommand(
          new Error(
            `The local PostgreSQL fixture command failed (${
              signal ?? code ?? "unknown"
            })${stderr ? `: ${stderr.slice(0, 4_000)}` : "."}`,
          ),
        );
        return;
      }
      resolveCommand(stdout);
    });
    child.stdin.end(`${sql}\n`);
  });
}

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const device =
    testInfo.project.name === "mobile-chromium"
      ? devices["Pixel 7"]
      : devices["Desktop Chrome"];
  return { ...device, baseURL: canonicalBaseUrl };
}

function credentials(identity: RealIdentity) {
  const [usernameName, passwordName] = identityEnvironment[identity];
  const username = requiredEnvironment(usernameName);
  const password = requiredEnvironment(passwordName);
  if (
    username !== expectedUsernames[identity] ||
    !username.endsWith("@autopayguard.local")
  ) {
    throw new Error(
      `${usernameName} must be the canonical ${identity} fake-local identity.`,
    );
  }
  return { username, password };
}

function requireExactEnvironment(name: string, expected: string) {
  if (requiredEnvironment(name) !== expected) {
    throw new Error(`${name} must equal the canonical fake-local value.`);
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for real-OIDC M5 acceptance.`);
  }
  return value;
}

function assertDisposableEmail(email: string) {
  if (
    email === expectedUsernames.owner ||
    !email.endsWith("@autopayguard.local")
  ) {
    throw new Error("Privacy fixture reset refused a protected/non-fake user.");
  }
}

function requireUuid(value: string, label: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`The ${label} identifier is not a UUIDv4.`);
  }
}

function requireM5IdempotencyRecordKey(
  value: string,
): [string, string, string] {
  if (!m5IdempotencyRecordKeyPattern.test(value)) {
    throw new Error("An M5 idempotency fixture key was invalid.");
  }
  const [actorUserId, operation, keyHash] = value.split(":");
  requireUuid(actorUserId!, "M5 idempotency actor");
  return [actorUserId!, operation!, keyHash!];
}

function hasCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
