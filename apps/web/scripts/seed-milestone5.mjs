import { chromium } from "@playwright/test";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = "http://localhost:3000";
const issuer = "http://localhost:8081/realms/autopay-guard";
const lockPath = join(tmpdir(), "autopay-guard-milestone5-seed.lock");
const canonicalCommitmentNames = new Set([
  "M2 Fixture StreamBox Demo",
  "M2 Fixture CloudNest Demo",
  "M2 Fixture FitClub Demo",
  "M2 Fixture Monsoon Utility Demo",
]);
const expectedUsernames = Object.freeze({
  owner: "demo@autopayguard.local",
  member: "member@autopayguard.local",
  foreign: "foreign@autopayguard.local",
  guideAdmin: "admin@autopayguard.local",
  privacyAdmin: "privacy-admin@autopayguard.local",
  auditRead: "audit-reader@autopayguard.local",
  supportRead: "support@autopayguard.local",
  deletion: "deletion@autopayguard.local",
});
const identityEnvironment = Object.freeze({
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
});

validateEnvironment();
const identities = loadIdentities();
const releaseLock = await acquireLock();
let browser;

try {
  await assertLocalStackReady();
  browser = await chromium.launch({ headless: true });

  const owner = await authenticatedPage(browser, identities.owner);
  const household = await assertOwnerBaseline(owner.page);
  await assertUserRoleIsolation(owner.page);
  await owner.context.close();

  for (const name of ["member", "foreign", "deletion"]) {
    const session = await authenticatedPage(browser, identities[name]);
    await assertUnscopedUserBaseline(
      session.page,
      identities[name].username,
      household.id,
    );
    await assertUserRoleIsolation(session.page);
    await session.context.close();
  }

  const guideAdmin = await authenticatedPage(browser, identities.guideAdmin);
  await assertMe(guideAdmin.page, identities.guideAdmin.username);
  await assertGuideAdminBaseline(guideAdmin.page);
  await assertStaffIsolation(guideAdmin.page, "GUIDE_ADMIN");
  await guideAdmin.context.close();

  const privacyAdmin = await authenticatedPage(
    browser,
    identities.privacyAdmin,
  );
  await assertMe(privacyAdmin.page, identities.privacyAdmin.username);
  await assertPrivacyAdminBaseline(privacyAdmin.page);
  await assertStaffIsolation(privacyAdmin.page, "PRIVACY_ADMIN");
  await privacyAdmin.context.close();

  const auditRead = await authenticatedPage(browser, identities.auditRead);
  await assertMe(auditRead.page, identities.auditRead.username);
  await assertAuditReadBaseline(auditRead.page);
  await assertStaffIsolation(auditRead.page, "AUDIT_READ");
  await auditRead.context.close();

  const supportRead = await authenticatedPage(browser, identities.supportRead);
  await assertMe(supportRead.page, identities.supportRead.username);
  await assertSupportReadBaseline(supportRead.page);
  await assertStaffIsolation(supportRead.page, "SUPPORT_READ");
  await supportRead.context.close();

  console.log(
    "Verified the eight distinct fake-local Milestone 5 identities, canonical private household baseline, exact staff-role isolation, redacted administrative reads, and absence of pending invitation/member residue.",
  );
} finally {
  await browser?.close();
  await releaseLock();
}

async function assertOwnerBaseline(page) {
  const me = await json(await api(page, "GET", "/v1/me"));
  if (
    me.email !== expectedUsernames.owner ||
    me.displayName !== "Demo User" ||
    me.ageConfirmed !== true ||
    me.privacyNoticeAccepted !== true
  ) {
    throw new Error(
      "The canonical owner is not the expected onboarded fake-local identity.",
    );
  }

  const households = await json(await api(page, "GET", "/v1/households"));
  if (!Array.isArray(households.items) || households.items.length === 0) {
    throw new Error(
      "The canonical owner has no household. Run the earlier seeders first.",
    );
  }
  const household = [...households.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
  if (
    household.defaultCurrency !== "INR" ||
    household.accessRole !== "OWNER" ||
    household.canManage !== true
  ) {
    throw new Error(
      "The canonical household does not expose immutable owner authority.",
    );
  }

  const commitments = await listCommitments(page, household.id);
  const activeCanonical = commitments.filter(
    ({ displayName, status }) =>
      status === "ACTIVE" && canonicalCommitmentNames.has(displayName),
  );
  if (
    activeCanonical.length !== canonicalCommitmentNames.size ||
    new Set(activeCanonical.map(({ displayName }) => displayName)).size !==
      canonicalCommitmentNames.size ||
    activeCanonical.some(
      (item) =>
        item.visibility !== "PRIVATE" ||
        item.responsibleMemberId !== null ||
        item.canManage !== true,
    )
  ) {
    throw new Error(
      "The four canonical commitments are not active, private, unassigned, and owner-managed.",
    );
  }

  const members = await json(
    await api(page, "GET", `/v1/households/${household.id}/members`),
  );
  if (
    !Array.isArray(members.items) ||
    members.items.filter(({ status }) => status === "ACTIVE").length !== 1 ||
    members.items.some(
      ({ role, status }) => status === "ACTIVE" && role !== "OWNER",
    )
  ) {
    throw new Error(
      "The canonical household has active member residue from a prior M5 run.",
    );
  }

  const invitations = await json(
    await api(page, "GET", `/v1/households/${household.id}/invitations`),
  );
  if (
    !Array.isArray(invitations.items) ||
    invitations.items.some(({ status }) => status === "PENDING")
  ) {
    throw new Error(
      "The canonical household has a pending invitation from a prior M5 run.",
    );
  }

  await assertPrivacyReadShapes(page);
  return household;
}

async function assertUnscopedUserBaseline(page, email, ownerHouseholdId) {
  await assertMe(page, email);
  const households = await json(await api(page, "GET", "/v1/households"));
  const incoming = await json(
    await api(page, "GET", "/v1/household-invitations"),
  );
  if (
    !Array.isArray(households.items) ||
    households.items.length !== 0 ||
    !Array.isArray(incoming.items) ||
    incoming.items.some(({ status }) => status === "PENDING")
  ) {
    throw new Error(
      "A non-owner fake user has household or invitation residue from a prior M5 run.",
    );
  }
  await api(page, "GET", `/v1/households/${ownerHouseholdId}/members`, {
    expectedStatus: 404,
  });
  await assertPrivacyReadShapes(page);
}

async function assertPrivacyReadShapes(page) {
  const currentNoticeResponse = await api(
    page,
    "GET",
    "/v1/privacy/notices/current",
  );
  const currentNotice = await json(currentNoticeResponse);
  assertExactKeys(
    currentNotice,
    ["noticeVersion", "contentSha256", "acknowledgementType"],
    "current privacy notice",
  );
  if (
    !currentNotice.noticeVersion ||
    !/^[a-f0-9]{64}$/.test(currentNotice.contentSha256) ||
    currentNotice.acknowledgementType !== "ACKNOWLEDGED"
  ) {
    throw new Error("The current privacy notice shape is invalid.");
  }

  const acknowledgementResponse = await api(
    page,
    "GET",
    "/v1/privacy/notice-acknowledgements",
  );
  const acknowledgements = await json(acknowledgementResponse);
  if (!Array.isArray(acknowledgements.items)) {
    throw new Error("Privacy acknowledgements did not return an items array.");
  }

  const consent = await json(await api(page, "GET", "/v1/privacy/consents"));
  assertExactKeys(
    consent,
    [
      "purpose",
      "currentPurposeVersion",
      "currentAction",
      "events",
      "nextCursor",
    ],
    "consent history",
  );
  const hasConsentEvents =
    Array.isArray(consent.events) && consent.events.length > 0;
  if (
    consent.purpose !== "HOUSEHOLD_SHARING" ||
    !Array.isArray(consent.events) ||
    (consent.nextCursor !== null && typeof consent.nextCursor !== "string") ||
    (hasConsentEvents &&
      (!consent.currentPurposeVersion ||
        !["GRANTED", "WITHDRAWN"].includes(consent.currentAction))) ||
    (!hasConsentEvents &&
      (consent.currentPurposeVersion !== null ||
        consent.currentAction !== null))
  ) {
    throw new Error("The consent history shape is invalid.");
  }

  const requestsResponse = await api(page, "GET", "/v1/privacy/requests");
  assertNoStore(requestsResponse, "subject privacy request list");
  const requests = await json(requestsResponse);
  if (!Array.isArray(requests.items)) {
    throw new Error("Privacy requests did not return an items array.");
  }
  for (const request of requests.items) {
    assertPrivacyRequest(request);
  }
}

async function assertGuideAdminBaseline(page) {
  const response = await api(page, "GET", "/v1/admin/cancellation-guides");
  assertNoStore(response, "guide catalog");
  const body = await json(response);
  if (!Array.isArray(body.items) || body.items.length !== 20) {
    throw new Error(
      "The GUIDE_ADMIN catalog must expose exactly twenty fictional guides.",
    );
  }
  for (const guide of body.items) {
    assertExactKeys(
      guide,
      [
        "guideId",
        "merchantId",
        "merchantName",
        "merchantCategory",
        "state",
        "currentPublishedVersion",
        "version",
        "updatedAt",
      ],
      "guide summary",
    );
    if (
      guide.state !== "ACTIVE" ||
      !Number.isInteger(guide.currentPublishedVersion) ||
      guide.currentPublishedVersion < 1
    ) {
      throw new Error(
        "A fictional guide is retired or lacks a published current head.",
      );
    }
    const versionsResponse = await api(
      page,
      "GET",
      `/v1/admin/cancellation-guides/${guide.guideId}/versions`,
    );
    assertNoStore(versionsResponse, "guide version history");
    const versions = await json(versionsResponse);
    if (
      !Array.isArray(versions.items) ||
      versions.items.length === 0 ||
      versions.items.some(
        ({ status, draftId, draftVersion }) =>
          status === "DRAFT" || draftId !== null || draftVersion !== null,
      )
    ) {
      throw new Error(
        "A fictional guide contains an uncleared editable draft.",
      );
    }
  }

  const feedbackResponse = await api(
    page,
    "GET",
    "/v1/admin/cancellation-guide-feedback?limit=50",
  );
  assertNoStore(feedbackResponse, "guide feedback queue");
  const feedback = await json(feedbackResponse);
  assertPageShape(feedback, "guide feedback");
  for (const item of feedback.items) {
    assertExactKeys(
      item,
      [
        "id",
        "guideId",
        "guideVersion",
        "outcome",
        "createdAt",
        "disposition",
        "version",
      ],
      "redacted guide feedback",
    );
  }
}

async function assertPrivacyAdminBaseline(page) {
  const response = await api(page, "GET", "/v1/admin/privacy/requests");
  assertNoStore(response, "privacy administration queue");
  const body = await json(response);
  if (!Array.isArray(body.items)) {
    throw new Error("The PRIVACY_ADMIN queue did not return an items array.");
  }
  for (const request of body.items) {
    assertPrivacyRequest(request);
  }
}

async function assertAuditReadBaseline(page) {
  const response = await api(page, "GET", "/v1/admin/audit-events?limit=50");
  assertNoStore(response, "audit event list");
  const body = await json(response);
  assertPageShape(body, "audit event");
  for (const event of body.items) {
    assertExactKeys(
      event,
      [
        "id",
        "occurredAt",
        "actorRole",
        "action",
        "resourceType",
        "resourceId",
        "outcome",
        "correlationId",
      ],
      "redacted audit event",
    );
    if (event.outcome !== "SUCCEEDED") {
      throw new Error("The redacted audit view returned an invalid outcome.");
    }
  }
}

async function assertSupportReadBaseline(page) {
  await api(page, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 404,
    data: { supportCode: "A".repeat(43) },
  });
}

async function assertUserRoleIsolation(page) {
  for (const path of [
    "/v1/admin/cancellation-guides",
    "/v1/admin/privacy/requests",
    "/v1/admin/audit-events?limit=1",
  ]) {
    await api(page, "GET", path, { expectedStatus: 403 });
  }
  await api(page, "POST", "/v1/support/diagnostics/resolve", {
    expectedStatus: 403,
    data: { supportCode: "A".repeat(43) },
  });
}

async function assertStaffIsolation(page, allowedRole) {
  const probes = [
    ["GUIDE_ADMIN", "GET", "/v1/admin/cancellation-guides", undefined],
    ["PRIVACY_ADMIN", "GET", "/v1/admin/privacy/requests", undefined],
    ["AUDIT_READ", "GET", "/v1/admin/audit-events?limit=1", undefined],
    [
      "SUPPORT_READ",
      "POST",
      "/v1/support/diagnostics/resolve",
      { supportCode: "A".repeat(43) },
    ],
  ];
  for (const [role, method, path, data] of probes) {
    if (role === allowedRole) {
      continue;
    }
    await api(page, method, path, { expectedStatus: 403, data });
  }
  await api(page, "GET", "/v1/households", { expectedStatus: 403 });
}

async function assertMe(page, expectedEmail) {
  const body = await json(await api(page, "GET", "/v1/me"));
  if (body.email !== expectedEmail) {
    throw new Error("An authenticated session resolved to the wrong identity.");
  }
}

async function listCommitments(page, householdId) {
  const items = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({
      householdId,
      includeArchived: "false",
      limit: "100",
    });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const body = await json(
      await api(page, "GET", `/v1/commitments?${query.toString()}`),
    );
    if (!Array.isArray(body.items)) {
      throw new Error("The commitment collection is invalid.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
  } while (cursor);
  return items;
}

function assertPrivacyRequest(request) {
  assertExactKeys(
    request,
    [
      "id",
      "requestType",
      "status",
      "correctionField",
      "correctionValue",
      "version",
      "createdAt",
      "updatedAt",
      "completedAt",
      "export",
    ],
    "privacy request",
  );
}

function assertPageShape(body, label) {
  assertExactKeys(body, ["items", "nextCursor"], `${label} page`);
  if (
    !Array.isArray(body.items) ||
    (body.nextCursor !== null && typeof body.nextCursor !== "string")
  ) {
    throw new Error(`The ${label} page shape is invalid.`);
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The ${label} is not a JSON object.`);
  }
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.join("\u0000") !== allowed.join("\u0000")) {
    throw new Error(`The ${label} returned fields outside its allowlist.`);
  }
}

function assertNoStore(response, label) {
  if (!(response.headers()["cache-control"] ?? "").includes("no-store")) {
    throw new Error(`The ${label} response was not marked no-store.`);
  }
}

async function authenticatedPage(browser, identity) {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  try {
    await page.goto("/signin?callbackUrl=%2Fmore", {
      waitUntil: "load",
    });
    const continueButton = page.getByRole("button", {
      name: "Continue securely",
    });
    await continueButton.waitFor({ state: "visible" });
    const signInActionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === baseUrl &&
        new URL(response.url()).pathname === "/signin",
      { timeout: 30_000 },
    );
    await continueButton.click();
    await signInActionResponsePromise;
    await page.locator("#username").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.locator("#username").fill(identity.username);
    await page.locator("#password").fill(identity.password);
    await page.locator("#kc-login").click();
    await page.waitForURL(
      (url) =>
        url.origin === baseUrl &&
        !url.pathname.startsWith("/signin") &&
        !url.pathname.startsWith("/api/auth"),
      { timeout: 30_000 },
    );
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function api(page, method, path, options = {}) {
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];
  const response = await page.request.fetch(`${baseUrl}/api/bff${path}`, {
    method,
    data: options.data,
    headers: {
      accept: "application/json, application/problem+json",
      origin: baseUrl,
      ...(options.data === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  if (!expected.includes(response.status())) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `Authenticated local request ${method} ${path.split("?")[0]} returned HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
}

async function json(response) {
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("An authenticated M5 response was not a JSON object.");
  }
  return body;
}

async function assertLocalStackReady() {
  const checks = [
    ["web", `${baseUrl}/signin`],
    ["API", "http://localhost:8080/actuator/health/readiness"],
    ["Keycloak", `${issuer}/.well-known/openid-configuration`],
    ["Mailpit", "http://localhost:8025/readyz"],
  ];
  for (const [name, url] of checks) {
    const response = await fetch(url, { redirect: "manual" });
    if (!response.ok) {
      throw new Error(`${name} is not ready at its canonical loopback URL.`);
    }
  }
}

function validateEnvironment() {
  requireExactEnvironment("COMPOSE_PROJECT_NAME", "autopay-guard");
  requireExactEnvironment("AUTH_URL", baseUrl);
  requireExactEnvironment("AUTH_KEYCLOAK_ISSUER", issuer);
}

function loadIdentities() {
  const result = {};
  for (const [name, [usernameName, passwordName]] of Object.entries(
    identityEnvironment,
  )) {
    const username = requiredEnvironment(usernameName);
    if (
      username !== expectedUsernames[name] ||
      !username.endsWith("@autopayguard.local")
    ) {
      throw new Error(
        `${usernameName} must be the canonical fake-local M5 identity.`,
      );
    }
    result[name] = {
      username,
      password: requiredEnvironment(passwordName),
    };
  }
  if (
    new Set(Object.values(result).map(({ username }) => username)).size !==
    Object.keys(result).length
  ) {
    throw new Error("Every Milestone 5 role must use a distinct identity.");
  }
  return result;
}

function requireExactEnvironment(name, expected) {
  if (requiredEnvironment(name) !== expected) {
    throw new Error(`${name} must equal the canonical fake-local value.`);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Milestone 5 seed verification.`);
  }
  return value;
}

async function acquireLock() {
  const token = crypto.randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another M5 seed verifier may be running. After checking processes, remove the stale lock at ${lockPath}.`,
      );
    }
    throw error;
  }
  await handle.writeFile(
    JSON.stringify({
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  );
  await handle.close();
  return async () => {
    const current = await readFile(lockPath, "utf8").catch(() => null);
    if (current) {
      const owner = JSON.parse(current);
      if (owner.token === token) {
        await rm(lockPath, { force: true });
      }
    }
  };
}
