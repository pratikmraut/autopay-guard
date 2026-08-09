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
  "milestone2.json",
);
const lockPath = join(tmpdir(), "autopay-guard-milestone2-seed.lock");

const baseUrl = localBaseUrl();
const username = requiredFakeIdentity("KEYCLOAK_FAKE_USER_USERNAME");
const password = requiredEnvironment("KEYCLOAK_FAKE_USER_PASSWORD");
if (requiredEnvironment("COMPOSE_PROJECT_NAME") !== "autopay-guard") {
  throw new Error(
    "Refusing to seed an unexpected Compose project. Expected autopay-guard.",
  );
}
if (
  requiredEnvironment("AUTH_KEYCLOAK_ISSUER") !==
  "http://localhost:8081/realms/autopay-guard"
) {
  throw new Error(
    "Milestone 2 seeding requires the canonical local Keycloak issuer.",
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

  const household = await resolveHousehold(page);
  if (household.defaultCurrency !== fixture.currency) {
    throw new Error(
      `The selected household currency is ${household.defaultCurrency}; the fixture requires ${fixture.currency}.`,
    );
  }

  const existing = await listAllCommitments(page, household.id);
  const activeUnreserved = existing.filter(
    (item) =>
      item.status !== "ARCHIVED" &&
      !fixture.commitments.some(
        (candidate) => candidate.displayName === item.displayName,
      ),
  );
  if (activeUnreserved.length > 0) {
    throw new Error(
      "The selected household contains non-fixture active commitments. Refusing to change or hide them; use an empty fake household for canonical seeding.",
    );
  }

  const missing = [];
  for (const candidate of fixture.commitments) {
    const matches = existing.filter(
      (item) => item.displayName === candidate.displayName,
    );
    if (matches.length > 1) {
      throw new Error(
        `Duplicate reserved fixture name detected: ${candidate.displayName}.`,
      );
    }
    if (matches.length === 1) {
      assertCommitmentMatch(matches[0], candidate);
      continue;
    }
    missing.push(candidate);
  }
  for (const candidate of missing) {
    await createCommitment(page, household.id, fixture.currency, candidate);
  }

  const seeded = await listAllCommitments(page, household.id);
  for (const candidate of fixture.commitments) {
    const matches = seeded.filter(
      (item) => item.displayName === candidate.displayName,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one seeded commitment named ${candidate.displayName}.`,
      );
    }
    assertCommitmentMatch(matches[0], candidate);
  }

  await assertSummary(page, household, seeded);
  await assertUpcomingCalendar(page, household);
  console.log(
    `Seeded and verified ${fixture.commitments.length} fake Milestone 2 commitments in the selected fake household.`,
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

async function resolveHousehold(page) {
  let response = await api(page, "GET", "/v1/households");
  let body = await response.json();
  if (!Array.isArray(body.items)) {
    throw new Error("The household response did not contain an items array.");
  }
  if (body.items.length === 0) {
    response = await api(page, "POST", "/v1/households", {
      name: fixture.householdFallbackName,
      defaultCurrency: fixture.currency,
      timezone: "Asia/Kolkata",
      ageConfirmed: true,
      privacyNoticeAccepted: true,
      privacyNoticeVersion: "foundation-v1",
    });
    body = await response.json();
    return body;
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
    const response = await api(
      page,
      "GET",
      `/v1/commitments?${query.toString()}`,
    );
    const body = await response.json();
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

async function createCommitment(page, householdId, currency, candidate) {
  const response = await api(page, "POST", "/v1/commitments", {
    householdId,
    merchantId: candidate.merchantId,
    displayName: candidate.displayName,
    category: candidate.category,
    paymentRail: candidate.paymentRail,
    amountMinor: candidate.amountMinor,
    estimatedAmountMinor: candidate.estimatedAmountMinor,
    currency,
    frequency: candidate.frequency,
    intervalCount: candidate.intervalCount,
    customIntervalUnit: candidate.customIntervalUnit,
    anchorDate: candidate.anchorDate,
    monthDayPolicy: candidate.monthDayPolicy,
    variableAmount: candidate.variableAmount,
    maskedPaymentLabel: candidate.maskedPaymentLabel,
  });
  if (response.status() !== 201) {
    throw new Error(
      `Commitment creation returned HTTP ${response.status()} instead of 201.`,
    );
  }
}

async function assertSummary(page, household, seeded) {
  const month = yearMonthInZone(household.timezone);
  const windows = projectionWindows(month);
  const query = new URLSearchParams({ householdId: household.id, month });
  const response = await api(
    page,
    "GET",
    `/v1/dashboard/summary?${query.toString()}`,
  );
  const summary = await response.json();
  if (summary.householdId !== household.id || summary.month !== month) {
    throw new Error(
      "The dashboard summary did not identify the requested household and calendar month.",
    );
  }
  if (
    summary.monthlyProjection?.from !== windows.monthlyFrom ||
    summary.monthlyProjection?.to !== windows.monthlyTo ||
    summary.annualizedProjection?.from !== windows.annualizedFrom ||
    summary.annualizedProjection?.to !== windows.annualizedTo
  ) {
    throw new Error("The dashboard projection windows did not reconcile.");
  }
  if (summary.activeCommitmentCount !== fixture.commitments.length) {
    throw new Error(
      "The canonical dashboard contains an unexpected number of active commitments.",
    );
  }
  if (summary.variableCommitmentCount !== 1) {
    throw new Error(
      "The canonical dashboard must contain one estimated-variable commitment.",
    );
  }
  if (summary.unknownVariableCommitmentCount !== 0) {
    throw new Error(
      "The canonical dashboard unexpectedly contains an unknown variable amount.",
    );
  }
  assertProjection(
    summary.monthlyProjection,
    fixture.expectedMonthlyProjection,
    "monthly",
  );
  assertProjection(
    summary.annualizedProjection,
    fixture.expectedAnnualizedProjection,
    "annualized",
  );

  const activeSeeded = seeded.filter((item) => item.status === "ACTIVE");
  if (activeSeeded.length !== fixture.commitments.length) {
    throw new Error("One or more canonical fixture commitments is not active.");
  }
}

async function assertUpcomingCalendar(page, household) {
  const currentMonth = yearMonthInZone(household.timezone);
  const nextMonth = addYearMonths(currentMonth, 1);
  const window = projectionWindows(nextMonth);
  const query = new URLSearchParams({
    householdId: household.id,
    from: window.monthlyFrom,
    to: window.monthlyTo,
  });
  const [upcomingResponse, calendarResponse] = await Promise.all([
    api(page, "GET", `/v1/commitments/upcoming?${query.toString()}`),
    api(page, "GET", `/v1/dashboard/calendar?${query.toString()}`),
  ]);
  const [upcoming, calendar] = await Promise.all([
    upcomingResponse.json(),
    calendarResponse.json(),
  ]);
  for (const value of [upcoming, calendar]) {
    if (
      value.householdId !== household.id ||
      value.from !== window.monthlyFrom ||
      value.to !== window.monthlyTo
    ) {
      throw new Error(
        "The upcoming/calendar response did not preserve the requested household-local window.",
      );
    }
  }
  const calendarItems = Array.isArray(calendar.days)
    ? calendar.days.flatMap(({ items }) => items ?? [])
    : [];
  if (
    !Array.isArray(upcoming.items) ||
    upcoming.items.length !== fixture.commitments.length ||
    calendarItems.length !== fixture.commitments.length
  ) {
    throw new Error(
      "The next full calendar month did not contain every canonical occurrence.",
    );
  }
  const upcomingIds = [...upcoming.items].map(({ id }) => id).sort();
  const calendarIds = calendarItems.map(({ id }) => id).sort();
  if (JSON.stringify(upcomingIds) !== JSON.stringify(calendarIds)) {
    throw new Error(
      "The upcoming list and calendar did not return the same occurrences.",
    );
  }
  for (const candidate of fixture.commitments) {
    const item = upcoming.items.find(
      ({ displayName }) => displayName === candidate.displayName,
    );
    const expectedDate =
      candidate.monthDayPolicy === "LAST_DAY"
        ? window.monthlyTo
        : `${nextMonth}-${candidate.anchorDate.slice(-2)}`;
    const expectedAmount = candidate.variableAmount
      ? candidate.estimatedAmountMinor
      : candidate.amountMinor;
    const expectedKind = candidate.variableAmount ? "ESTIMATED" : "FIXED";
    if (
      !item ||
      item.scheduledDate !== expectedDate ||
      item.expectedAmountMinor !== expectedAmount ||
      item.amountKind !== expectedKind ||
      item.currency !== fixture.currency
    ) {
      throw new Error(
        `The upcoming occurrence for ${candidate.displayName} did not reconcile.`,
      );
    }
  }
}

function assertProjection(actual, expected, label) {
  if (
    actual.occurrenceCount !== expected.occurrenceCount ||
    actual.unknownVariableOccurrenceCount !==
      expected.unknownVariableOccurrenceCount
  ) {
    throw new Error(`The ${label} occurrence counts did not reconcile.`);
  }
  const totals = Array.isArray(actual.totals) ? actual.totals : [];
  if (totals.length !== 1) {
    throw new Error(
      `The ${label} projection must contain exactly one currency bucket.`,
    );
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key !== "occurrenceCount" && totals[0][key] !== value) {
      throw new Error(`The ${label} ${key} value did not reconcile.`);
    }
  }
}

function assertCommitmentMatch(actual, expected) {
  if (actual.status !== "ACTIVE") {
    throw new Error(
      `Reserved fixture ${expected.displayName} is not active; refusing to recreate or overwrite it.`,
    );
  }
  const fields = [
    "merchantId",
    "displayName",
    "category",
    "paymentRail",
    "amountMinor",
    "estimatedAmountMinor",
    "frequency",
    "intervalCount",
    "customIntervalUnit",
    "anchorDate",
    "monthDayPolicy",
    "variableAmount",
    "maskedPaymentLabel",
  ];
  for (const field of fields) {
    if ((actual[field] ?? null) !== (expected[field] ?? null)) {
      throw new Error(
        `Reserved fixture ${expected.displayName} conflicts on ${field}; refusing to overwrite it.`,
      );
    }
  }
  if (
    actual.currency !== fixture.currency ||
    actual.source !== "MANUAL" ||
    actual.sourceConfidence !== null ||
    actual.visibility !== "PRIVATE"
  ) {
    throw new Error(
      `Reserved fixture ${expected.displayName} has unexpected server-owned metadata.`,
    );
  }
}

async function api(page, method, path, data) {
  const response = await page.request.fetch(`${baseUrl}/api/bff${path}`, {
    method,
    data,
    headers: {
      accept: "application/json, application/problem+json",
      origin: baseUrl,
      ...(data === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  if (!response.ok()) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `The authenticated seed request failed with HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
}

function yearMonthInZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find(({ type }) => type === "year")?.value;
  const month = parts.find(({ type }) => type === "month")?.value;
  if (!year || !month) {
    throw new Error("Could not derive the household-local calendar month.");
  }
  return `${year}-${month}`;
}

function projectionWindows(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthlyFrom = `${month}-01`;
  const monthlyTo = new Date(Date.UTC(year, monthNumber, 0))
    .toISOString()
    .slice(0, 10);
  const annualizedTo = new Date(Date.UTC(year + 1, monthNumber - 1, 0))
    .toISOString()
    .slice(0, 10);
  return {
    monthlyFrom,
    monthlyTo,
    annualizedFrom: monthlyFrom,
    annualizedTo,
  };
}

function addYearMonths(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
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
      "Milestone 2 seeding requires the canonical local AUTH_URL http://localhost:3000.",
    );
  }
  value.pathname = "/";
  value.search = "";
  value.hash = "";
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
    throw new Error(`${name} is required for Milestone 2 seeding.`);
  }
  return value;
}

function validateManifest(value) {
  if (
    value.fixtureVersion !== 1 ||
    value.currency !== "INR" ||
    !Array.isArray(value.commitments) ||
    value.commitments.length !== 4
  ) {
    throw new Error("The Milestone 2 fixture manifest is invalid.");
  }
  const names = new Set(
    value.commitments.map(({ displayName }) => displayName),
  );
  if (names.size !== value.commitments.length) {
    throw new Error("The Milestone 2 fixture names must be unique.");
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
        `Another seed process may be running. After verifying no seeder is active, remove the stale lock at ${lockPath}.`,
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
