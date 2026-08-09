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
  "milestone3.json",
);
const lockPath = join(tmpdir(), "autopay-guard-milestone3-seed.lock");

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
    "Milestone 3 seeding requires the canonical local Keycloak issuer.",
  );
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
validateManifest(fixture);
const stagedPreferences = { ...fixture.preferences, enabled: false };
// An early local-only M3 build bound PostgreSQL TIME values through the UTC
// JDBC calendar. Recognize only that exact reserved fixture representation so
// the corrected build can disable delivery, rewrite it, and opt back in safely.
const legacyShiftedPreferences = {
  ...fixture.preferences,
  quietStart: "16:30",
  quietEnd: "01:30",
};
const legacyShiftedStagedPreferences = {
  ...legacyShiftedPreferences,
  enabled: false,
};
const legacyShiftedLocalTimes = new Map([
  ["09:00", "03:30"],
  ["10:00", "04:30"],
]);

const releaseLock = await acquireLock();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  await signIn(page);

  const household = await resolveHousehold(page);
  const commitments = await listAllActiveCommitments(page, household.id);
  const scopedCommitments = [];
  for (const expected of fixture.commitmentRules) {
    const matches = commitments.filter(
      ({ displayName }) => displayName === expected.displayName,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one active fake commitment named ${expected.displayName}. Run the Milestone 2 seeder first and resolve any duplicate reserved names.`,
      );
    }
    scopedCommitments.push({ commitment: matches[0], expected });
  }

  const preflight = await readConfigurationPreflight(
    page,
    household.id,
    scopedCommitments,
  );
  await applyConfiguration(page, preflight);

  console.log(
    "Seeded and verified explicit fake Milestone 3 notification preferences and reminder rules.",
  );
} finally {
  await browser?.close();
  await releaseLock();
}

async function readConfigurationPreflight(
  page,
  householdId,
  scopedCommitments,
) {
  const preferencesPath = "/v1/notification-preferences";
  const preferenceResource = await getVersioned(page, preferencesPath);
  let preferenceState;
  if (preferenceResource.body.version === 0) {
    assertSyntheticPreferences(preferenceResource.body);
    preferenceState = "SYNTHETIC";
  } else if (preferencesMatch(preferenceResource.body, fixture.preferences)) {
    assertVersionMetadata(preferenceResource.body, "notification preferences");
    preferenceState = "CANONICAL";
  } else if (preferencesMatch(preferenceResource.body, stagedPreferences)) {
    assertVersionMetadata(preferenceResource.body, "notification preferences");
    preferenceState = "STAGED";
  } else if (
    preferencesMatch(preferenceResource.body, legacyShiftedPreferences)
  ) {
    assertVersionMetadata(preferenceResource.body, "notification preferences");
    preferenceState = "LEGACY_SHIFTED";
  } else if (
    preferencesMatch(preferenceResource.body, legacyShiftedStagedPreferences)
  ) {
    assertVersionMetadata(preferenceResource.body, "notification preferences");
    preferenceState = "LEGACY_SHIFTED_STAGED";
  } else {
    throw new Error(
      "The existing fake notification preferences conflict with the canonical, safely staged, or exact legacy-shifted fixture; refusing to overwrite them.",
    );
  }

  const ruleResources = [];
  const householdPath = `/v1/households/${householdId}/reminder-rules`;
  ruleResources.push(
    await preflightRuleSet(
      page,
      householdPath,
      fixture.householdRules,
      householdId,
      null,
    ),
  );
  for (const { commitment, expected } of scopedCommitments) {
    ruleResources.push(
      await preflightRuleSet(
        page,
        `/v1/commitments/${commitment.id}/reminder-rules`,
        expected,
        householdId,
        commitment.id,
      ),
    );
  }

  return {
    preferences: {
      path: preferencesPath,
      resource: preferenceResource,
      state: preferenceState,
    },
    ruleResources,
  };
}

async function preflightRuleSet(
  page,
  path,
  expected,
  householdId,
  commitmentId,
) {
  const resource = await getVersioned(page, path);
  if (resource.body.version === 0) {
    assertSyntheticRuleSet(resource.body, householdId, commitmentId);
    return {
      path,
      resource,
      expected,
      householdId,
      commitmentId,
      needsWrite: expected.mode !== "INHERIT",
    };
  }
  if (ruleSetMatches(resource.body, expected, householdId, commitmentId)) {
    assertVersionMetadata(resource.body, "reminder rules");
    return {
      path,
      resource,
      expected,
      householdId,
      commitmentId,
      needsWrite: false,
    };
  }

  const legacyExpected = legacyShiftedRuleConfiguration(expected);
  if (
    ruleSetMatches(resource.body, legacyExpected, householdId, commitmentId)
  ) {
    assertVersionMetadata(resource.body, "reminder rules");
    return {
      path,
      resource,
      expected,
      householdId,
      commitmentId,
      needsWrite: true,
    };
  }

  assertRuleSet(resource.body, expected, householdId, commitmentId);
  return {
    path,
    resource,
    expected,
    householdId,
    commitmentId,
    needsWrite: false,
  };
}

async function applyConfiguration(page, preflight) {
  const writes = preflight.ruleResources.filter(({ needsWrite }) => needsWrite);
  let preferences = preflight.preferences.resource;
  if (writes.length === 0 && preflight.preferences.state === "CANONICAL") {
    return;
  }

  if (preflight.preferences.state !== "STAGED") {
    preferences = await putVersioned(
      page,
      preflight.preferences.path,
      stagedPreferences,
      preferences.etag,
    );
    assertPreferences(preferences.body, stagedPreferences);
  }

  for (const write of writes) {
    const updated = await putVersioned(
      page,
      write.path,
      { mode: write.expected.mode, rules: write.expected.rules },
      write.resource.etag,
    );
    assertRuleSet(
      updated.body,
      write.expected,
      write.householdId,
      write.commitmentId,
    );
  }

  preferences = await putVersioned(
    page,
    preflight.preferences.path,
    fixture.preferences,
    preferences.etag,
  );
  assertPreferences(preferences.body, fixture.preferences);
}

async function getVersioned(page, path) {
  const response = await api(page, "GET", path);
  const body = await response.json();
  return { body, etag: assertEtag(response, body.version) };
}

async function putVersioned(page, path, data, etag) {
  const response = await api(page, "PUT", path, data, {
    "if-match": etag,
  });
  const body = await response.json();
  return { body, etag: assertEtag(response, body.version) };
}

function assertPreferences(actual, expected) {
  if (!preferencesMatch(actual, expected)) {
    throw new Error(
      "The saved fake notification preferences did not match the requested fixture.",
    );
  }
  assertVersionMetadata(actual, "notification preferences");
}

function preferencesMatch(actual, expected) {
  return Object.entries(expected).every(
    ([key, value]) => (actual[key] ?? null) === (value ?? null),
  );
}

function assertSyntheticPreferences(actual) {
  const expected = {
    enabled: false,
    inAppEnabled: false,
    emailEnabled: false,
    timezone: fixture.preferences.timezone,
    quietHoursEnabled: false,
    quietStart: null,
    quietEnd: null,
  };
  if (!preferencesMatch(actual, expected)) {
    throw new Error(
      "The synthetic notification preferences were not safely disabled.",
    );
  }
  assertVersionMetadata(actual, "notification preferences");
}

function assertRuleSet(actual, expected, householdId, commitmentId) {
  if (!ruleSetMatches(actual, expected, householdId, commitmentId)) {
    throw new Error(
      `The existing fake reminder rules for ${expected.displayName ?? "the household"} conflict; refusing to overwrite them.`,
    );
  }
  assertVersionMetadata(actual, "reminder rules");
}

function ruleSetMatches(actual, expected, householdId, commitmentId) {
  if (
    actual.householdId !== householdId ||
    (actual.commitmentId ?? null) !== commitmentId ||
    actual.mode !== expected.mode
  ) {
    return false;
  }
  const expectedSuggestions =
    commitmentId === null ? fixture.householdRules.rules : [];
  return (
    JSON.stringify(normalizedRules(actual.rules)) ===
      JSON.stringify(normalizedRules(expected.rules)) &&
    JSON.stringify(normalizedRules(actual.suggestedRules)) ===
      JSON.stringify(normalizedRules(expectedSuggestions))
  );
}

function legacyShiftedRuleConfiguration(configuration) {
  return {
    ...configuration,
    rules: configuration.rules.map((rule) => {
      const localSendTime = legacyShiftedLocalTimes.get(rule.localSendTime);
      if (!localSendTime) {
        throw new Error(
          "The exact legacy-shift upgrade does not cover this reminder time.",
        );
      }
      return { ...rule, localSendTime };
    }),
  };
}

function assertSyntheticRuleSet(actual, householdId, commitmentId) {
  const expected = {
    mode: commitmentId === null ? "DISABLED" : "INHERIT",
    rules: [],
  };
  assertRuleSet(actual, expected, householdId, commitmentId);
  if (actual.id !== null || actual.updatedAt !== null || actual.version !== 0) {
    throw new Error(
      "A synthetic reminder-rule response unexpectedly claimed persisted state.",
    );
  }
}

function assertVersionMetadata(actual, label) {
  if (!Number.isSafeInteger(actual.version) || actual.version < 0) {
    throw new Error(`The ${label} response contained an invalid version.`);
  }
  if (actual.version === 0) {
    if (actual.id !== null || actual.updatedAt !== null) {
      throw new Error(
        `The synthetic ${label} response unexpectedly claimed persisted state.`,
      );
    }
    return;
  }
  if (
    typeof actual.id !== "string" ||
    typeof actual.updatedAt !== "string" ||
    Number.isNaN(Date.parse(actual.updatedAt))
  ) {
    throw new Error(`The persisted ${label} metadata is invalid.`);
  }
}

function assertEtag(response, version) {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error("A versioned API response contained an invalid version.");
  }
  const etag = response.headers().etag;
  if (etag !== `"${version}"`) {
    throw new Error(
      `A versioned API response returned ETag ${etag ?? "missing"} for version ${version}.`,
    );
  }
  return etag;
}

function normalizedRules(rules) {
  if (!Array.isArray(rules)) {
    throw new Error("A reminder-rule response omitted its rules array.");
  }
  return rules
    .map(({ channel, offsetDays, localSendTime, enabled }) => ({
      channel,
      offsetDays,
      localSendTime,
      enabled,
    }))
    .sort((left, right) =>
      `${left.offsetDays}:${left.channel}`.localeCompare(
        `${right.offsetDays}:${right.channel}`,
      ),
    );
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
  const response = await api(page, "GET", "/v1/households");
  const body = await response.json();
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error(
      "Milestone 3 seeding requires the fake household created by the earlier milestone.",
    );
  }
  return [...body.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
}

async function listAllActiveCommitments(page, householdId) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  let pageCount = 0;
  do {
    pageCount++;
    if (pageCount > 10) {
      throw new Error(
        "The commitment list exceeded the bounded seed preflight.",
      );
    }
    if (cursor && seenCursors.has(cursor)) {
      throw new Error("The commitment list repeated a pagination cursor.");
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
    const query = new URLSearchParams({
      householdId,
      includeArchived: "false",
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
    if (
      cursor !== null &&
      (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    ) {
      throw new Error("The commitment response returned an invalid cursor.");
    }
  } while (cursor);
  const ids = new Set(items.map(({ id }) => id));
  if (ids.size !== items.length) {
    throw new Error(
      "The commitment response repeated an item across pagination.",
    );
  }
  return items;
}

async function api(page, method, path, data, extraHeaders = {}) {
  const response = await page.request.fetch(`${baseUrl}/api/bff${path}`, {
    method,
    data,
    headers: {
      accept: "application/json, application/problem+json",
      origin: baseUrl,
      ...(data === undefined ? {} : { "content-type": "application/json" }),
      ...extraHeaders,
    },
  });
  if (!response.ok()) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `The authenticated Milestone 3 seed request failed with HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
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
      "Milestone 3 seeding requires the canonical local AUTH_URL http://localhost:3000.",
    );
  }
  value.pathname = "/";
  value.search = "";
  value.hash = "";
  return value.origin;
}

function requiredFakeIdentity(name) {
  const value = requiredEnvironment(name);
  if (
    !value.endsWith("@autopayguard.local") &&
    !value.endsWith(".example.test")
  ) {
    throw new Error(`${name} must identify a fake local user.`);
  }
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Milestone 3 seeding.`);
  }
  return value;
}

function validateManifest(value) {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "fixtureVersion",
      "preferences",
      "householdRules",
      "commitmentRules",
    ]) ||
    value.fixtureVersion !== 1 ||
    !isPlainObject(value.preferences) ||
    !isPlainObject(value.householdRules) ||
    !Array.isArray(value.commitmentRules) ||
    value.commitmentRules.length !== 4
  ) {
    throw new Error("The Milestone 3 fixture manifest is invalid.");
  }

  const preferenceKeys = [
    "enabled",
    "inAppEnabled",
    "emailEnabled",
    "timezone",
    "quietHoursEnabled",
    "quietStart",
    "quietEnd",
  ];
  if (
    !hasExactKeys(value.preferences, preferenceKeys) ||
    value.preferences.enabled !== true ||
    value.preferences.inAppEnabled !== true ||
    value.preferences.emailEnabled !== true ||
    value.preferences.timezone !== "Asia/Kolkata" ||
    value.preferences.quietHoursEnabled !== true ||
    !isMinuteTime(value.preferences.quietStart) ||
    !isMinuteTime(value.preferences.quietEnd) ||
    value.preferences.quietStart === value.preferences.quietEnd
  ) {
    throw new Error(
      "The Milestone 3 preference fixture must be an explicit, bounded fake-local opt-in.",
    );
  }

  validateRuleConfiguration(value.householdRules, false);
  if (value.householdRules.mode !== "CUSTOM") {
    throw new Error("The household fixture must provide custom default rules.");
  }
  const expectedSuggestions = [];
  for (const offsetDays of [7, 3, 1]) {
    for (const channel of ["IN_APP", "EMAIL"]) {
      expectedSuggestions.push({
        channel,
        offsetDays,
        localSendTime: "09:00",
        enabled: true,
      });
    }
  }
  if (
    JSON.stringify(normalizedRules(value.householdRules.rules)) !==
    JSON.stringify(normalizedRules(expectedSuggestions))
  ) {
    throw new Error(
      "The household fixture must contain the exact 7-, 3-, and 1-day suggestions for both channels.",
    );
  }

  const expectedNames = new Set([
    "M2 Fixture StreamBox Demo",
    "M2 Fixture CloudNest Demo",
    "M2 Fixture FitClub Demo",
    "M2 Fixture Monsoon Utility Demo",
  ]);
  const names = new Set(
    value.commitmentRules.map(({ displayName }) => displayName),
  );
  if (
    names.size !== value.commitmentRules.length ||
    [...names].some((name) => !expectedNames.has(name))
  ) {
    throw new Error("The Milestone 3 commitment fixture names must be unique.");
  }
  for (const configuration of value.commitmentRules) {
    validateRuleConfiguration(configuration, true);
  }
  const modes = new Set(value.commitmentRules.map(({ mode }) => mode));
  if (!modes.has("INHERIT") || !modes.has("CUSTOM") || !modes.has("DISABLED")) {
    throw new Error(
      "The commitment fixtures must exercise inherit, custom, and disabled modes.",
    );
  }
}

function validateRuleConfiguration(configuration, commitmentScope) {
  const keys = commitmentScope
    ? ["displayName", "mode", "rules"]
    : ["mode", "rules"];
  if (
    !isPlainObject(configuration) ||
    !hasExactKeys(configuration, keys) ||
    !["INHERIT", "CUSTOM", "DISABLED"].includes(configuration.mode) ||
    (!commitmentScope && configuration.mode === "INHERIT") ||
    !Array.isArray(configuration.rules) ||
    configuration.rules.length > 182 ||
    (configuration.mode === "CUSTOM" && configuration.rules.length === 0) ||
    (configuration.mode !== "CUSTOM" && configuration.rules.length !== 0)
  ) {
    throw new Error("A Milestone 3 reminder-rule fixture is invalid.");
  }
  if (
    commitmentScope &&
    (typeof configuration.displayName !== "string" ||
      configuration.displayName.length === 0 ||
      configuration.displayName !== configuration.displayName.trim())
  ) {
    throw new Error("A commitment reminder fixture name is invalid.");
  }

  const identities = new Set();
  for (const rule of configuration.rules) {
    if (
      !isPlainObject(rule) ||
      !hasExactKeys(rule, [
        "channel",
        "offsetDays",
        "localSendTime",
        "enabled",
      ]) ||
      !["IN_APP", "EMAIL"].includes(rule.channel) ||
      !Number.isInteger(rule.offsetDays) ||
      rule.offsetDays < 0 ||
      rule.offsetDays > 90 ||
      !isMinuteTime(rule.localSendTime) ||
      typeof rule.enabled !== "boolean"
    ) {
      throw new Error("A Milestone 3 reminder rule is invalid.");
    }
    const identity = `${rule.channel}:${rule.offsetDays}`;
    if (identities.has(identity)) {
      throw new Error(
        "The Milestone 3 fixture contains a duplicate channel and offset.",
      );
    }
    identities.add(identity);
  }
}

function isMinuteTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(required);
}

async function acquireLock() {
  const token = crypto.randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another Milestone 3 seed process may be running. After verifying no seeder is active, remove the stale lock at ${lockPath}.`,
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
