import { chromium } from "@playwright/test";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const fixturePath = join(
  repositoryRoot,
  "infra",
  "local",
  "fixtures",
  "milestone4.json",
);
const lockPath = join(tmpdir(), "autopay-guard-milestone4-seed.lock");

const baseUrl = localBaseUrl();
const username = requiredFakeIdentity("KEYCLOAK_FAKE_USER_USERNAME");
const password = requiredEnvironment("KEYCLOAK_FAKE_USER_PASSWORD");
if (requiredEnvironment("COMPOSE_PROJECT_NAME") !== "autopay-guard") {
  throw new Error(
    "Refusing to validate an unexpected Compose project. Expected autopay-guard.",
  );
}
if (
  requiredEnvironment("AUTH_KEYCLOAK_ISSUER") !==
  "http://localhost:8081/realms/autopay-guard"
) {
  throw new Error(
    "Milestone 4 seeding requires the canonical local Keycloak issuer.",
  );
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
validateManifest(fixture);

const releaseLock = await acquireLock();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  await signIn(page);

  const household = await resolveOldestHousehold(page);
  const commitments = await listAllCommitments(page, household.id);
  for (const expected of fixture.canonicalCommitmentGuides) {
    const matches = commitments.filter(
      (candidate) =>
        candidate.status === "ACTIVE" &&
        candidate.displayName === expected.displayName,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one active canonical commitment named ${expected.displayName}. Run the Milestone 2 seeder first.`,
      );
    }
    const guideManifest = fixture.guides.find(
      ({ guideId }) => guideId === expected.guideId,
    );
    if (!guideManifest) {
      throw new Error(
        `The canonical guide ${expected.guideId} is absent from the Milestone 4 manifest.`,
      );
    }
    const guide = await json(
      await api(
        page,
        "GET",
        `/v1/commitments/${matches[0].id}/cancellation-guide`,
      ),
    );
    assertGuide(guide, household.id, matches[0].id, guideManifest);
  }

  await assertDecisionInbox(page, household);
  await assertSavingsShape(page, household.id);
  console.log(
    `Verified ${fixture.guides.length} migration-backed fictional Milestone 4 guide fixtures and the authenticated M4 read surfaces without creating user records.`,
  );
} finally {
  await browser?.close();
  await releaseLock();
}

async function signIn(page) {
  await page.goto("/signin", { waitUntil: "load" });
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
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await page.waitForURL(/\/(?:onboarding|dashboard)(?:\?.*)?$/, {
    timeout: 30_000,
  });
}

async function resolveOldestHousehold(page) {
  const body = await json(await api(page, "GET", "/v1/households"));
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error(
      "The fake identity has no household. Run the Milestone 2 seeder first.",
    );
  }
  return [...body.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
}

async function listAllCommitments(page, householdId) {
  const items = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({
      householdId,
      includeArchived: "true",
      limit: "100",
    });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const body = await json(
      await api(page, "GET", `/v1/commitments?${query.toString()}`),
    );
    if (!Array.isArray(body.items)) {
      throw new Error(
        "The commitment response did not contain an items array.",
      );
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
  } while (cursor);
  return items;
}

function assertGuide(guide, householdId, commitmentId, expected) {
  const reviewedAt = new Date(fixture.structuralReviewedAt);
  const expectedReviewDue = new Date(reviewedAt);
  expectedReviewDue.setUTCDate(
    expectedReviewDue.getUTCDate() + fixture.reviewIntervalDays,
  );
  const guideChecks = {
    id: guide.id === expected.guideId,
    version: guide.version === 1,
    householdId: guide.householdId === householdId,
    commitmentId: guide.commitmentId === commitmentId,
    merchantName: guide.merchantName === expected.merchantName,
    status: guide.status === "PUBLISHED",
    freshness: guide.freshness === "CURRENT",
    structuralReviewedAt:
      guide.structuralReviewedAt === fixture.structuralReviewedAt,
    reviewDueAt:
      typeof guide.reviewDueAt === "string" &&
      Date.parse(guide.reviewDueAt) === expectedReviewDue.getTime(),
    publishedAt: guide.publishedAt === fixture.structuralReviewedAt,
    targetsSuppressed: guide.targetsSuppressed === false,
    targetSuppressionReason: guide.targetSuppressionReason === "NONE",
    riskNotice:
      typeof guide.riskNotice === "string" &&
      guide.riskNotice.includes(fixture.riskNoticeIncludes),
  };
  const failedGuideChecks = Object.entries(guideChecks)
    .filter(([, passed]) => !passed)
    .map(([field]) => field);
  if (failedGuideChecks.length > 0) {
    throw new Error(
      `The current guide for ${expected.merchantName} does not match the immutable local fixture fields: ${failedGuideChecks.join(", ")}.`,
    );
  }
  if (!Array.isArray(guide.tracks) || guide.tracks.length !== 2) {
    throw new Error(
      `The guide for ${expected.merchantName} must contain exactly two tracks.`,
    );
  }

  const service = guide.tracks.find(({ track }) => track === "SERVICE");
  const mandate = guide.tracks.find(({ track }) => track === "PAYMENT_MANDATE");
  assertTrack(service, "SERVICE");
  assertTrack(mandate, "PAYMENT_MANDATE");

  const serviceTarget = service.steps[1]?.target;
  const mandateTarget = mandate.steps[1]?.target;
  if (
    service.steps[0]?.kind !== "INFORMATION" ||
    service.steps[0]?.target !== null ||
    service.steps[1]?.kind !== "SAFE_LINK" ||
    serviceTarget?.uri !==
      `https://${expected.host}${fixture.serviceTargetPath}` ||
    mandate.steps[0]?.kind !== "INFORMATION" ||
    mandate.steps[0]?.target !== null ||
    mandate.steps[1]?.kind !== "APP_DEEP_LINK" ||
    mandateTarget?.uri !== fixture.mandateTarget
  ) {
    throw new Error(
      `The safe target structure for ${expected.merchantName} did not match the local allowlist.`,
    );
  }
  assertExactSafeTarget(serviceTarget.uri, expected.host);
  assertExactSafeTarget(mandateTarget.uri, "mandates");
}

function assertTrack(track, expectedKind) {
  if (
    !track ||
    track.track !== expectedKind ||
    typeof track.title !== "string" ||
    track.title.trim().length === 0 ||
    !Array.isArray(track.steps) ||
    track.steps.length !== 2 ||
    track.steps[0]?.sequence !== 1 ||
    track.steps[1]?.sequence !== 2
  ) {
    throw new Error(
      `The ${expectedKind} guide track is missing or incorrectly ordered.`,
    );
  }
}

function assertExactSafeTarget(value, expectedHost) {
  if (
    value.length > 2_048 ||
    /[^\x21-\x7e]/.test(value) ||
    value.includes("\\") ||
    /%(?:2e|2f|3a|40|5c)/i.test(value)
  ) {
    throw new Error("A fictional guide target failed the ASCII safety policy.");
  }
  const parsed = new URL(value);
  if (
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname !== expectedHost ||
    parsed.href !== value
  ) {
    throw new Error("A fictional guide target was not canonical.");
  }
  if (
    parsed.protocol === "https:" &&
    (parsed.pathname !== fixture.serviceTargetPath ||
      !parsed.hostname.endsWith(".example"))
  ) {
    throw new Error("An HTTPS guide target left its exact fixture boundary.");
  }
  if (
    parsed.protocol === "autopayguard-demo:" &&
    (parsed.hostname !== "mandates" || parsed.pathname !== "/service/manage")
  ) {
    throw new Error("A demo-app guide target left its exact fixture boundary.");
  }
  if (
    parsed.protocol !== "https:" &&
    parsed.protocol !== "autopayguard-demo:"
  ) {
    throw new Error("A guide target used a forbidden scheme.");
  }
}

async function assertDecisionInbox(page, household) {
  const from = localDateInTimeZone(household.timezone);
  const to = addDays(from, 89);
  const query = new URLSearchParams({
    householdId: household.id,
    from,
    to,
    limit: "100",
  });
  const body = await json(
    await api(page, "GET", `/v1/decisions/inbox?${query.toString()}`),
  );
  if (
    body.householdId !== household.id ||
    body.from !== from ||
    body.to !== to ||
    !Array.isArray(body.items) ||
    body.items.some(
      (item) =>
        item.householdId !== household.id ||
        !Array.isArray(item.reviewActions) ||
        item.reviewActions.length === 0 ||
        (item.currentDecision &&
          (item.currentDecision.householdId !== household.id ||
            item.currentDecision.occurrenceId !== item.occurrenceId)),
    )
  ) {
    throw new Error(
      "The decision inbox did not preserve the owned household and occurrence scope.",
    );
  }
}

async function assertSavingsShape(page, householdId) {
  const query = new URLSearchParams({ householdId, limit: "100" });
  const body = await json(
    await api(page, "GET", `/v1/savings?${query.toString()}`),
  );
  if (
    body.householdId !== householdId ||
    typeof body.asOf !== "string" ||
    !Number.isInteger(body.unquantifiedCount) ||
    body.unquantifiedCount < 0 ||
    !Array.isArray(body.currencies) ||
    !Array.isArray(body.items)
  ) {
    throw new Error("The savings response did not match the owned M4 shape.");
  }
  const allowedStates = new Set([
    "POTENTIAL",
    "SELF_REPORTED",
    "VERIFIED",
    "REVERSED",
  ]);
  for (const currency of body.currencies) {
    if (
      !/^[A-Z]{3}$/.test(currency.currency) ||
      !Array.isArray(currency.totals) ||
      new Set(currency.totals.map(({ state }) => state)).size !==
        currency.totals.length ||
      currency.totals.some(
        (total) =>
          !allowedStates.has(total.state) ||
          "amountMinor" in total ||
          "attemptCount" in total ||
          !Number.isSafeInteger(total.exactAmountMinor) ||
          total.exactAmountMinor < 0 ||
          !Number.isSafeInteger(total.estimatedAmountMinor) ||
          total.estimatedAmountMinor < 0 ||
          !Number.isInteger(total.exactAttemptCount) ||
          total.exactAttemptCount < 0 ||
          !Number.isInteger(total.estimatedAttemptCount) ||
          total.estimatedAttemptCount < 0,
      )
    ) {
      throw new Error(
        "Savings currency buckets did not keep exact states separate.",
      );
    }
  }
  if (
    body.items.some(
      (item) =>
        !allowedStates.has(item.state) ||
        item.commitmentId.length === 0 ||
        (item.amountMinor !== null &&
          (!Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0)),
    )
  ) {
    throw new Error("A savings item contained an invalid state or amount.");
  }
}

async function api(page, method, path) {
  const response = await page.request.fetch(`${baseUrl}/api/bff${path}`, {
    method,
    headers: {
      accept: "application/json, application/problem+json",
      origin: baseUrl,
    },
  });
  if (!response.ok()) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `The authenticated M4 seed verification failed with HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
}

async function json(response) {
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The authenticated M4 response was not a JSON object.");
  }
  return body;
}

function localDateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  );
  if (!value.year || !value.month || !value.day) {
    throw new Error("Could not derive the household-local date.");
  }
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(localDate, days) {
  const value = new Date(`${localDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localBaseUrl() {
  const configured = requiredEnvironment("AUTH_URL");
  const value = new URL(configured);
  if (
    value.origin !== "http://localhost:3000" ||
    value.username ||
    value.password ||
    (value.pathname !== "/" && value.pathname !== "")
  ) {
    throw new Error(
      "Milestone 4 seeding requires the canonical local AUTH_URL http://localhost:3000.",
    );
  }
  return value.origin;
}

function requiredFakeIdentity(name) {
  const value = requiredEnvironment(name);
  if (!value.endsWith("@autopayguard.local")) {
    throw new Error(`${name} must identify the fake local user.`);
  }
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Milestone 4 seeding.`);
  }
  return value;
}

function validateManifest(value) {
  if (
    value.fixtureVersion !== 1 ||
    value.structuralReviewedAt !== "2026-07-27T00:00:00Z" ||
    value.reviewIntervalDays !== 60 ||
    value.serviceTargetPath !== "/manage/subscription" ||
    value.mandateTarget !== "autopayguard-demo://mandates/service/manage" ||
    !Array.isArray(value.guides) ||
    value.guides.length !== 20 ||
    !Array.isArray(value.canonicalCommitmentGuides) ||
    value.canonicalCommitmentGuides.length !== 3
  ) {
    throw new Error("The Milestone 4 fixture manifest is invalid.");
  }
  for (const field of [
    "number",
    "merchantId",
    "guideId",
    "merchantName",
    "host",
  ]) {
    if (
      new Set(value.guides.map((guide) => guide[field])).size !==
      value.guides.length
    ) {
      throw new Error(`Milestone 4 guide ${field} values must be unique.`);
    }
  }
  if (
    value.guides.some(
      ({ number, merchantId, guideId, category, host }) =>
        !Number.isInteger(number) ||
        number < 1 ||
        number > 20 ||
        !/^10000000-0000-4000-8000-0000000000\d{2}$/.test(merchantId) ||
        !/^40000000-0000-4000-8000-0000000000\d{2}$/.test(guideId) ||
        !["SUBSCRIPTION", "MEMBERSHIP", "SOFTWARE"].includes(category) ||
        !/^[a-z0-9]+\.example$/.test(host),
    )
  ) {
    throw new Error("A Milestone 4 guide fixture identifier is invalid.");
  }
}

async function acquireLock() {
  const token = crypto.randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another M4 seed verifier may be running. After verifying no verifier is active, remove the stale lock at ${lockPath}.`,
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
