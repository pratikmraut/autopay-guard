import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const acknowledgement = "I_ACKNOWLEDGE_LOCAL_FAKE_M3_ACCEPTANCE";
const canonicalFakeEmail = "demo@autopayguard.local";
const canonicalPreferences = {
  enabled: true,
  inAppEnabled: true,
  emailEnabled: true,
  timezone: "Asia/Kolkata",
  quietHoursEnabled: true,
  quietStart: "22:00",
  quietEnd: "07:00",
};
const deliveryPreferences = {
  ...canonicalPreferences,
  quietHoursEnabled: false,
  quietStart: null,
  quietEnd: null,
};
const reservedNames = [
  "M3 Live Mailpit Capture",
  "M3 Live Provider Outage",
  "M3 Live Quiet Optout",
];
const reservedNameSet = new Set(reservedNames);
const genericEmailSubject = "AutoPay Guard reminder";
const genericEmailBody =
  "You have an upcoming recurring commitment to review. " +
  "Sign in to AutoPay Guard to see the details. " +
  "AutoPay Guard does not move money or change payment mandates.";
const fakeFromAddress = "no-reply@autopayguard.local";
const dockerExecutable =
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const composeFile = join(repositoryRoot, "compose.yaml");
const dockerConfigDirectory = join(repositoryRoot, ".tools", "docker-config");
const dockerConfigFile = join(dockerConfigDirectory, "config.json");
const lockPath = join(
  tmpdir(),
  "autopay-guard-milestone3-live-acceptance.lock",
);

validateEnvironment();
await Promise.all([
  access(dockerExecutable),
  access(composeFile),
  access(dockerConfigFile),
]);

const baseUrl = "http://localhost:3000";
const mailpitBaseUrl = "http://localhost:8025";
const fakePassword = requiredEnvironment("KEYCLOAK_FAKE_USER_PASSWORD");
const releaseLock = await acquireLock();

let browser;
let page;
let householdId = null;
let mayRestoreCanonicalState = false;
let primaryFailure = null;
const createdCommitmentIds = new Set();

try {
  await ensureMailpitUp();
  await assertLocalStackReady();

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  page = await context.newPage();
  await signIn(page);

  const currentUser = await readCurrentUser(page);
  const household = await resolveOldestOwnedHousehold(page);
  householdId = household.id;

  const initialPreferences = await getVersioned(
    page,
    "/v1/notification-preferences",
  );
  if (
    !preferencesMatch(initialPreferences.body, canonicalPreferences) &&
    !preferencesMatch(initialPreferences.body, deliveryPreferences)
  ) {
    throw new Error(
      "Notification preference preflight matched neither the canonical fixture nor the exact interrupted live-delivery fixture.",
    );
  }
  mayRestoreCanonicalState = true;

  await archiveReservedCommitments(page, householdId);

  await exerciseMailpitCapture(
    page,
    currentUser,
    household,
    createdCommitmentIds,
  );
  await exerciseProviderOutage(
    page,
    currentUser,
    household,
    createdCommitmentIds,
  );
  await exerciseQuietOptOut(page, currentUser, household, createdCommitmentIds);

  console.log(
    "Milestone 3 live acceptance passed: Mailpit capture/dedup, provider retry/recovery, and quiet-hour opt-out suppression.",
  );
} catch (error) {
  primaryFailure = error;
} finally {
  const cleanupFailures = [];

  try {
    await ensureMailpitUp();
  } catch (error) {
    cleanupFailures.push(
      new Error("Mailpit could not be restored during cleanup.", {
        cause: error,
      }),
    );
  }

  if (page && householdId && mayRestoreCanonicalState) {
    try {
      await savePreferences(page, canonicalPreferences);
      await archiveReservedCommitments(page, householdId);
      const restored = await getVersioned(page, "/v1/notification-preferences");
      assertPreferences(
        restored.body,
        canonicalPreferences,
        "cleanup verification",
      );
    } catch (error) {
      cleanupFailures.push(
        new Error(
          "Canonical preferences or reserved commitments could not be restored.",
          { cause: error },
        ),
      );
    }
  }

  try {
    await browser?.close();
  } catch (error) {
    cleanupFailures.push(
      new Error("The acceptance browser could not be closed.", {
        cause: error,
      }),
    );
  }

  try {
    await releaseLock();
  } catch (error) {
    cleanupFailures.push(
      new Error("The live-acceptance lock could not be released.", {
        cause: error,
      }),
    );
  }

  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures],
      "Milestone 3 live acceptance failed and cleanup was incomplete.",
    );
  }
  if (primaryFailure) {
    throw primaryFailure;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      "Milestone 3 live acceptance passed, but cleanup was incomplete.",
    );
  }
}

async function exerciseMailpitCapture(
  authenticatedPage,
  currentUser,
  household,
  createdIds,
) {
  console.log("Checking real local Mailpit delivery and cross-minute dedup.");
  await savePreferences(authenticatedPage, deliveryPreferences);

  const commitment = await createReservedCommitment(
    authenticatedPage,
    household,
    reservedNames[0],
    "Fake rail 0001",
  );
  createdIds.add(commitment.id);
  const plan = buildReminderPlan(household.timezone, commitment.nextDueDate);
  await saveCommitmentRules(authenticatedPage, commitment.id, [
    reminderRule("EMAIL", plan),
  ]);

  const criteria = notificationCriteria(
    household.id,
    commitment,
    "EMAIL",
    plan,
  );
  const expectedMessageId = stableMessageId(currentUser.id, criteria);
  await assertMailpitMessageCount(expectedMessageId, 0);

  const delivered = await waitForNotificationStatus(
    authenticatedPage,
    criteria,
    "DELIVERED",
    Math.max(Date.now() + 30_000, plan.targetEpochMs + 120_000),
  );
  assertDeliveredNotification(delivered, criteria);
  await waitForMailpitCapture(expectedMessageId, {
    recipient: currentUser.email,
    displayName: commitment.displayName,
    maskedPaymentLabel: commitment.maskedPaymentLabel,
  });

  await waitForAnotherGeneratorCycle();
  await assertSingleNotification(authenticatedPage, criteria, delivered.id);
  await assertMailpitMessageCount(expectedMessageId, 1);
}

async function exerciseProviderOutage(
  authenticatedPage,
  currentUser,
  household,
  createdIds,
) {
  console.log(
    "Checking a real Mailpit outage, safe retry diagnostics, and recovery.",
  );
  await savePreferences(authenticatedPage, deliveryPreferences);
  const diagnosticsBefore = await readDiagnostics(
    authenticatedPage,
    household.id,
  );

  const commitment = await createReservedCommitment(
    authenticatedPage,
    household,
    reservedNames[1],
    "Fake rail 0002",
  );
  createdIds.add(commitment.id);
  const plan = buildReminderPlan(household.timezone, commitment.nextDueDate);
  await saveCommitmentRules(authenticatedPage, commitment.id, [
    reminderRule("EMAIL", plan),
  ]);

  const criteria = notificationCriteria(
    household.id,
    commitment,
    "EMAIL",
    plan,
  );
  const expectedMessageId = stableMessageId(currentUser.id, criteria);
  await assertMailpitMessageCount(expectedMessageId, 0);

  await stopMailpit();
  await waitForMailpitUnavailable();

  const retryScheduled = await waitForNotificationStatus(
    authenticatedPage,
    criteria,
    "RETRY_SCHEDULED",
    Math.max(Date.now() + 30_000, plan.targetEpochMs + 120_000),
  );
  if (
    retryScheduled.failureCategory !== "PROVIDER_TRANSIENT" ||
    typeof retryScheduled.nextAttemptAt !== "string" ||
    Date.parse(retryScheduled.nextAttemptAt) <= Date.now()
  ) {
    throw new Error(
      "The outage did not create a bounded transient retry with a future attempt.",
    );
  }

  const retryDiagnostics = await readDiagnostics(
    authenticatedPage,
    household.id,
  );
  assertSafeRetryDiagnostics(
    retryDiagnostics,
    diagnosticsBefore,
    currentUser.email,
    commitment,
  );

  await ensureMailpitUp();
  const retryEpochMs = Date.parse(retryScheduled.nextAttemptAt);
  const delivered = await waitForNotificationStatus(
    authenticatedPage,
    criteria,
    "DELIVERED",
    Math.max(Date.now() + 90_000, retryEpochMs + 120_000),
  );
  assertDeliveredNotification(delivered, criteria);
  await waitForMailpitCapture(expectedMessageId, {
    recipient: currentUser.email,
    displayName: commitment.displayName,
    maskedPaymentLabel: commitment.maskedPaymentLabel,
  });
  await assertMailpitMessageCount(expectedMessageId, 1);
}

async function exerciseQuietOptOut(
  authenticatedPage,
  currentUser,
  household,
  createdIds,
) {
  console.log(
    "Checking quiet-hour deferral followed by an in-app channel opt-out.",
  );
  const commitment = await createReservedCommitment(
    authenticatedPage,
    household,
    reservedNames[2],
    "Fake rail 0003",
  );
  createdIds.add(commitment.id);
  const plan = buildReminderPlan(household.timezone, commitment.nextDueDate);
  const deferredEpochMs = plan.targetEpochMs + 3 * 60_000;
  const quietPreferences = {
    ...canonicalPreferences,
    quietStart: minuteTimeInZone(
      plan.targetEpochMs,
      canonicalPreferences.timezone,
    ),
    quietEnd: minuteTimeInZone(deferredEpochMs, canonicalPreferences.timezone),
  };
  if (quietPreferences.quietStart === quietPreferences.quietEnd) {
    throw new Error("The live quiet-hour window unexpectedly collapsed.");
  }
  await savePreferences(authenticatedPage, quietPreferences);
  await saveCommitmentRules(authenticatedPage, commitment.id, [
    reminderRule("IN_APP", plan),
  ]);

  const criteria = notificationCriteria(
    household.id,
    commitment,
    "IN_APP",
    plan,
  );
  const pending = await waitForNotificationStatus(
    authenticatedPage,
    criteria,
    "PENDING",
    Math.max(Date.now() + 30_000, plan.targetEpochMs + 90_000),
  );
  if (
    typeof pending.nextAttemptAt !== "string" ||
    Math.abs(Date.parse(pending.nextAttemptAt) - deferredEpochMs) > 1_000
  ) {
    throw new Error(
      "Quiet hours did not defer the logical notification to the configured end.",
    );
  }
  if (Date.now() >= deferredEpochMs - 20_000) {
    throw new Error(
      "There was not enough time to opt out safely before quiet hours ended.",
    );
  }

  await savePreferences(authenticatedPage, {
    ...quietPreferences,
    inAppEnabled: false,
  });

  const suppressed = await waitForNotificationStatus(
    authenticatedPage,
    criteria,
    "SUPPRESSED",
    Math.max(Date.now() + 60_000, deferredEpochMs + 90_000),
  );
  if (
    suppressed.failureCategory !== "DELIVERY_INVALIDATED" ||
    suppressed.nextAttemptAt !== null ||
    suppressed.deliveredAt !== null
  ) {
    throw new Error(
      "The deferred in-app reminder was not safely suppressed after opt-out.",
    );
  }

  await waitForAnotherGeneratorCycle();
  await assertSingleNotification(authenticatedPage, criteria, suppressed.id);
  const allForCommitment = await matchingNotifications(authenticatedPage, {
    householdId: household.id,
    commitmentId: commitment.id,
    scheduledDate: commitment.nextDueDate,
    offsetDays: plan.offsetDays,
  });
  if (
    allForCommitment.length !== 1 ||
    allForCommitment[0].channel !== "IN_APP"
  ) {
    throw new Error(
      "Quiet-hour opt-out created a duplicate or an unintended email notification.",
    );
  }

  const impossibleEmailMessageId = stableMessageId(currentUser.id, {
    ...criteria,
    channel: "EMAIL",
  });
  await assertMailpitMessageCount(impossibleEmailMessageId, 0);
}

async function createReservedCommitment(
  authenticatedPage,
  household,
  displayName,
  maskedPaymentLabel,
) {
  if (!reservedNameSet.has(displayName)) {
    throw new Error("Refusing to create a non-reserved live fixture.");
  }
  const anchorDate = localDateInZone(
    Date.now() + 30 * 86_400_000,
    household.timezone,
  );
  const response = await api(authenticatedPage, "POST", "/v1/commitments", {
    expectedStatus: 201,
    data: {
      householdId: household.id,
      merchantId: null,
      displayName,
      category: "SOFTWARE",
      paymentRail: "CARD_RECURRING",
      amountMinor: 100,
      estimatedAmountMinor: null,
      currency: "INR",
      frequency: "MONTHLY",
      intervalCount: 1,
      customIntervalUnit: null,
      anchorDate,
      monthDayPolicy: "ANCHOR_DAY",
      variableAmount: false,
      maskedPaymentLabel,
    },
  });
  const body = await response.json();
  if (
    body.householdId !== household.id ||
    body.displayName !== displayName ||
    body.status !== "ACTIVE" ||
    body.amountMinor !== 100 ||
    body.currency !== "INR" ||
    body.nextDueDate !== anchorDate ||
    body.paymentRail !== "CARD_RECURRING" ||
    body.maskedPaymentLabel !== maskedPaymentLabel
  ) {
    throw new Error(
      "The reserved live commitment returned unexpected fake-local state.",
    );
  }
  assertVersionAndEtag(response, body, "commitment creation");
  return body;
}

async function saveCommitmentRules(authenticatedPage, commitmentId, rules) {
  const path = `/v1/commitments/${encodeURIComponent(commitmentId)}/reminder-rules`;
  const current = await getVersioned(authenticatedPage, path);
  const response = await api(authenticatedPage, "PUT", path, {
    expectedStatus: 200,
    headers: { "if-match": current.etag },
    data: { mode: "CUSTOM", rules },
  });
  const body = await response.json();
  const projection = {
    mode: body.mode,
    rules: normalizeRules(body.rules),
  };
  const expected = { mode: "CUSTOM", rules: normalizeRules(rules) };
  if (
    body.commitmentId !== commitmentId ||
    JSON.stringify(projection) !== JSON.stringify(expected)
  ) {
    throw new Error("The custom reminder-rule save returned unexpected state.");
  }
  assertVersionAndEtag(response, body, "reminder-rule save");
}

function reminderRule(channel, plan) {
  return {
    channel,
    offsetDays: plan.offsetDays,
    localSendTime: plan.localSendTime,
    enabled: true,
  };
}

async function savePreferences(authenticatedPage, expected) {
  const path = "/v1/notification-preferences";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const current = await getVersioned(authenticatedPage, path);
    const response = await api(authenticatedPage, "PUT", path, {
      expectedStatus: [200, 412],
      headers: { "if-match": current.etag },
      data: expected,
    });
    if (response.status() === 412 && attempt < 3) {
      continue;
    }
    if (response.status() !== 200) {
      throw new Error(
        `Notification preferences remained stale after ${attempt} attempts.`,
      );
    }
    const body = await response.json();
    assertVersionAndEtag(response, body, "notification-preference save");
    assertPreferences(body, expected, "save");
    return body;
  }
  throw new Error("Notification preferences could not be saved.");
}

async function archiveReservedCommitments(
  authenticatedPage,
  selectedHouseholdId,
) {
  const commitments = await listActiveCommitments(
    authenticatedPage,
    selectedHouseholdId,
  );
  for (const commitment of commitments) {
    if (!reservedNameSet.has(commitment.displayName)) {
      continue;
    }
    await archiveCommitment(authenticatedPage, commitment.id);
  }
  const remaining = await listActiveCommitments(
    authenticatedPage,
    selectedHouseholdId,
  );
  if (remaining.some(({ displayName }) => reservedNameSet.has(displayName))) {
    throw new Error("Reserved live commitments remained active after cleanup.");
  }
}

async function archiveCommitment(authenticatedPage, commitmentId) {
  const path = `/v1/commitments/${encodeURIComponent(commitmentId)}`;
  const currentResponse = await api(authenticatedPage, "GET", path, {
    expectedStatus: [200, 404],
  });
  if (currentResponse.status() === 404) {
    return;
  }
  const current = await currentResponse.json();
  if (current.id !== commitmentId) {
    throw new Error("Reserved commitment cleanup returned a different record.");
  }
  if (current.status === "ARCHIVED") {
    return;
  }
  const etag = assertVersionAndEtag(
    currentResponse,
    current,
    "commitment cleanup GET",
  );
  await api(authenticatedPage, "DELETE", path, {
    expectedStatus: 204,
    headers: { "if-match": etag },
  });
}

async function listActiveCommitments(authenticatedPage, selectedHouseholdId) {
  const items = [];
  let cursor = null;
  const seen = new Set();
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const query = new URLSearchParams({
      householdId: selectedHouseholdId,
      includeArchived: "false",
      limit: "100",
    });
    if (cursor) {
      if (seen.has(cursor)) {
        throw new Error("Commitment pagination repeated a cursor.");
      }
      seen.add(cursor);
      query.set("cursor", cursor);
    }
    const response = await api(
      authenticatedPage,
      "GET",
      `/v1/commitments?${query}`,
    );
    const body = await response.json();
    if (!Array.isArray(body.items)) {
      throw new Error("Commitment pagination omitted its items.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
    if (!cursor) {
      const ids = new Set(items.map(({ id }) => id));
      if (ids.size !== items.length) {
        throw new Error("Commitment pagination returned duplicate records.");
      }
      return items;
    }
  }
  throw new Error("Commitment pagination exceeded its local bound.");
}

async function waitForNotificationStatus(
  authenticatedPage,
  criteria,
  expectedStatus,
  deadlineEpochMs,
) {
  while (Date.now() <= deadlineEpochMs) {
    const matches = await matchingNotifications(authenticatedPage, criteria);
    if (matches.length > 1) {
      throw new Error(
        "The scheduler created more than one semantic notification.",
      );
    }
    if (matches.length === 1) {
      const [notification] = matches;
      if (notification.status === expectedStatus) {
        return notification;
      }
      if (["DEAD", "SUPPRESSED", "DELIVERED"].includes(notification.status)) {
        throw new Error(
          `Notification reached ${notification.status} while waiting for ${expectedStatus}.`,
        );
      }
    }
    await sleep(2_000);
  }
  throw new Error(
    `Timed out waiting for a live notification to reach ${expectedStatus}.`,
  );
}

async function assertSingleNotification(
  authenticatedPage,
  criteria,
  expectedId,
) {
  const matches = await matchingNotifications(authenticatedPage, criteria);
  if (matches.length !== 1 || matches[0].id !== expectedId) {
    throw new Error(
      "A later generator cycle did not preserve one logical notification.",
    );
  }
}

async function matchingNotifications(authenticatedPage, criteria) {
  const items = [];
  let cursor = null;
  const seen = new Set();
  for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
    const query = new URLSearchParams({
      householdId: criteria.householdId,
      filter: "ALL",
      limit: "100",
    });
    if (cursor) {
      if (seen.has(cursor)) {
        throw new Error("Notification pagination repeated a cursor.");
      }
      seen.add(cursor);
      query.set("cursor", cursor);
    }
    const response = await api(
      authenticatedPage,
      "GET",
      `/v1/notifications?${query}`,
    );
    const body = await response.json();
    if (
      body.householdId !== criteria.householdId ||
      body.filter !== "ALL" ||
      !Array.isArray(body.items)
    ) {
      throw new Error("Notification pagination returned an unexpected scope.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
    if (!cursor) {
      return items.filter(
        (candidate) =>
          candidate.householdId === criteria.householdId &&
          candidate.commitmentId === criteria.commitmentId &&
          candidate.scheduledDate === criteria.scheduledDate &&
          candidate.offsetDays === criteria.offsetDays &&
          (criteria.channel === undefined ||
            candidate.channel === criteria.channel),
      );
    }
  }
  throw new Error("Notification pagination exceeded its local bound.");
}

function notificationCriteria(selectedHouseholdId, commitment, channel, plan) {
  return {
    householdId: selectedHouseholdId,
    commitmentId: commitment.id,
    scheduledDate: commitment.nextDueDate,
    channel,
    offsetDays: plan.offsetDays,
  };
}

function assertDeliveredNotification(notification, criteria) {
  if (
    notification.householdId !== criteria.householdId ||
    notification.commitmentId !== criteria.commitmentId ||
    notification.scheduledDate !== criteria.scheduledDate ||
    notification.channel !== criteria.channel ||
    notification.offsetDays !== criteria.offsetDays ||
    notification.status !== "DELIVERED" ||
    notification.failureCategory !== "NONE" ||
    typeof notification.deliveredAt !== "string" ||
    notification.nextAttemptAt !== null
  ) {
    throw new Error("The delivered notification returned unexpected state.");
  }
}

async function readDiagnostics(authenticatedPage, selectedHouseholdId) {
  const query = new URLSearchParams({
    householdId: selectedHouseholdId,
  });
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/notification-diagnostics?${query}`,
  );
  const body = await response.json();
  const expectedKeys = [
    "householdId",
    "pendingCount",
    "processingCount",
    "retryScheduledCount",
    "deliveredCount",
    "deadCount",
    "suppressedCount",
    "oldestPendingAgeSeconds",
    "nextRetryAt",
    "failures",
  ].sort();
  if (
    JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(expectedKeys) ||
    body.householdId !== selectedHouseholdId ||
    !Array.isArray(body.failures)
  ) {
    throw new Error(
      "Notification diagnostics returned an unsafe or unexpected shape.",
    );
  }
  for (const countName of [
    "pendingCount",
    "processingCount",
    "retryScheduledCount",
    "deliveredCount",
    "deadCount",
    "suppressedCount",
  ]) {
    if (!Number.isSafeInteger(body[countName]) || body[countName] < 0) {
      throw new Error("Notification diagnostics returned an invalid count.");
    }
  }
  for (const failure of body.failures) {
    if (
      JSON.stringify(Object.keys(failure).sort()) !==
        JSON.stringify(["category", "count"]) ||
      ![
        "NONE",
        "PROVIDER_TRANSIENT",
        "PROVIDER_PERMANENT",
        "PROVIDER_TIMEOUT",
        "RECIPIENT_NOT_FAKE",
        "DELIVERY_INVALIDATED",
        "QUIET_HOURS_EXPIRED",
        "INTERNAL_PAYLOAD",
      ].includes(failure.category) ||
      !Number.isSafeInteger(failure.count) ||
      failure.count < 1
    ) {
      throw new Error(
        "Notification diagnostics returned invalid failure data.",
      );
    }
  }
  return body;
}

function assertSafeRetryDiagnostics(actual, before, recipient, commitment) {
  if (actual.retryScheduledCount < 1) {
    throw new Error("Owner diagnostics did not expose the scheduled retry.");
  }
  const actualTransient =
    actual.failures.find(({ category }) => category === "PROVIDER_TRANSIENT")
      ?.count ?? 0;
  const priorTransient =
    before.failures.find(({ category }) => category === "PROVIDER_TRANSIENT")
      ?.count ?? 0;
  if (actualTransient < priorTransient + 1) {
    throw new Error(
      "Owner diagnostics did not count the transient provider failure.",
    );
  }
  const serialized = JSON.stringify(actual).toLowerCase();
  for (const forbidden of [
    recipient.toLowerCase(),
    commitment.displayName.toLowerCase(),
    commitment.maskedPaymentLabel.toLowerCase(),
    "card_recurring",
    "connection refused",
    "exception",
    "stacktrace",
    "smtp",
    "mailpit",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(
        "Owner diagnostics exposed recipient, commitment, or raw provider data.",
      );
    }
  }
}

async function waitForMailpitCapture(expectedMessageId, expected) {
  const deadline = Date.now() + 60_000;
  while (Date.now() <= deadline) {
    const matches = await mailpitMessagesById(expectedMessageId);
    if (matches.length > 1) {
      throw new Error(
        "Mailpit captured more than one message for the semantic reminder.",
      );
    }
    if (matches.length === 1) {
      await assertGenericMailpitMessage(
        matches[0],
        expectedMessageId,
        expected,
      );
      return;
    }
    await sleep(1_000);
  }
  throw new Error("Mailpit did not capture the expected fake-local message.");
}

async function assertMailpitMessageCount(expectedMessageId, expectedCount) {
  const matches = await mailpitMessagesById(expectedMessageId);
  if (matches.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} Mailpit message(s) for the semantic reminder, found ${matches.length}.`,
    );
  }
}

async function mailpitMessagesById(expectedMessageId) {
  const summary = await mailpitJson("/api/v1/messages?start=0&limit=500");
  if (
    !Array.isArray(summary.messages) ||
    !Number.isSafeInteger(summary.total) ||
    summary.total < summary.messages.length
  ) {
    throw new Error("Mailpit returned an invalid message summary.");
  }
  return summary.messages.filter(
    ({ MessageID }) =>
      normalizeMessageId(MessageID) === normalizeMessageId(expectedMessageId),
  );
}

async function assertGenericMailpitMessage(
  summary,
  expectedMessageId,
  expected,
) {
  if (typeof summary.ID !== "string" || summary.ID.length === 0) {
    throw new Error("Mailpit returned a message without a local ID.");
  }
  const message = await mailpitJson(
    `/api/v1/message/${encodeURIComponent(summary.ID)}`,
  );
  const recipients = Array.isArray(message.To) ? message.To : [];
  const attachments = Array.isArray(message.Attachments)
    ? message.Attachments
    : [];
  const inline = Array.isArray(message.Inline) ? message.Inline : [];
  if (
    normalizeMessageId(message.MessageID) !==
      normalizeMessageId(expectedMessageId) ||
    message.Subject !== genericEmailSubject ||
    message.Text?.trim() !== genericEmailBody ||
    (message.HTML ?? "") !== "" ||
    message.From?.Address !== fakeFromAddress ||
    recipients.length !== 1 ||
    recipients[0]?.Address !== expected.recipient ||
    attachments.length !== 0 ||
    inline.length !== 0
  ) {
    throw new Error(
      "Mailpit captured a message outside the generic fake-local boundary.",
    );
  }
  const visibleContent =
    `${message.Subject}\n${message.Text}\n${message.HTML ?? ""}`.toLowerCase();
  for (const forbidden of [
    expected.displayName.toLowerCase(),
    expected.maskedPaymentLabel.toLowerCase(),
    "card_recurring",
    "₹",
    "inr",
    "100",
  ]) {
    if (visibleContent.includes(forbidden)) {
      throw new Error(
        "The local email exposed commitment, amount, or payment data.",
      );
    }
  }
}

async function mailpitJson(path) {
  const response = await fetch(`${mailpitBaseUrl}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`The local Mailpit API returned HTTP ${response.status}.`);
  }
  return response.json();
}

function stableMessageId(currentUserId, criteria) {
  const canonical = [
    currentUserId,
    criteria.householdId,
    criteria.commitmentId,
    criteria.scheduledDate,
    criteria.channel,
    String(criteria.offsetDays),
  ].join("\u001f");
  const semanticKey = createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
  return `<apg-${semanticKey}@autopayguard.local>`;
}

function normalizeMessageId(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed
    : `<${trimmed}>`;
}

function buildReminderPlan(timezone, scheduledDate) {
  const targetEpochMs = Math.ceil((Date.now() + 75_000) / 60_000) * 60_000;
  const targetLocalDate = localDateInZone(targetEpochMs, timezone);
  const offsetDays =
    (parseLocalDate(scheduledDate) - parseLocalDate(targetLocalDate)) /
    86_400_000;
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 90) {
    throw new Error(
      `The live fixture requires unsupported reminder offset ${offsetDays}.`,
    );
  }
  return {
    targetEpochMs,
    offsetDays,
    localSendTime: minuteTimeInZone(targetEpochMs, timezone),
  };
}

function localDateInZone(epochMs, timezone) {
  const parts = dateTimeParts(epochMs, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minuteTimeInZone(epochMs, timezone) {
  const parts = dateTimeParts(epochMs, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function dateTimeParts(epochMs, timezone) {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epochMs);
  const part = (type) => {
    const value = formatted.find((candidate) => candidate.type === type)?.value;
    if (!value) {
      throw new Error(
        `Could not resolve ${type} in local timezone ${timezone}.`,
      );
    }
    return value;
  };
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid local date ${value}.`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid local date ${value}.`);
  }
  return parsed;
}

async function readCurrentUser(authenticatedPage) {
  const response = await api(authenticatedPage, "GET", "/v1/me");
  const body = await response.json();
  if (
    body.email !== canonicalFakeEmail ||
    body.displayName !== "Demo User" ||
    body.timezone !== "Asia/Kolkata" ||
    body.locale !== "en-IN" ||
    typeof body.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.id,
    ) ||
    body.ageConfirmed !== true ||
    body.privacyNoticeAccepted !== true
  ) {
    throw new Error(
      "Refusing to run against anything except the canonical onboarded fake local identity.",
    );
  }
  return body;
}

async function resolveOldestOwnedHousehold(authenticatedPage) {
  const response = await api(authenticatedPage, "GET", "/v1/households");
  const body = await response.json();
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error("The canonical fake user has no owned local household.");
  }
  const household = [...body.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
  if (
    typeof household.id !== "string" ||
    typeof household.timezone !== "string" ||
    household.defaultCurrency !== "INR"
  ) {
    throw new Error(
      "The oldest owned household is not the canonical INR fixture.",
    );
  }
  return household;
}

async function signIn(authenticatedPage) {
  await authenticatedPage.goto("/signin", {
    waitUntil: "load",
  });
  const continueButton = authenticatedPage.getByRole("button", {
    name: "Continue securely",
  });
  await continueButton.waitFor({ state: "visible" });
  const signInActionResponsePromise = authenticatedPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === baseUrl &&
      new URL(response.url()).pathname === "/signin",
    { timeout: 30_000 },
  );
  await continueButton.click();
  await signInActionResponsePromise;
  await authenticatedPage.locator("#username").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await authenticatedPage.locator("#username").fill(canonicalFakeEmail);
  await authenticatedPage.locator("#password").fill(fakePassword);
  await authenticatedPage.locator("#kc-login").click();
  await authenticatedPage.waitForURL(/\/(?:onboarding|dashboard)(?:\?.*)?$/, {
    timeout: 30_000,
  });
}

async function getVersioned(authenticatedPage, path) {
  const response = await api(authenticatedPage, "GET", path);
  const body = await response.json();
  const etag = assertVersionAndEtag(response, body, "versioned resource GET");
  return { body, etag };
}

async function api(authenticatedPage, method, path, options = {}) {
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];
  const response = await authenticatedPage.request.fetch(
    `${baseUrl}/api/bff${path}`,
    {
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
    },
  );
  if (!expected.includes(response.status())) {
    const correlationId =
      response.headers()["x-correlation-id"] ?? "not-provided";
    throw new Error(
      `Authenticated local request ${method} ${path.split("?")[0]} returned HTTP ${response.status()} (correlation ${correlationId}).`,
    );
  }
  return response;
}

function assertVersionAndEtag(response, body, operation) {
  if (!Number.isSafeInteger(body.version) || body.version < 0) {
    throw new Error(`${operation} returned an invalid version.`);
  }
  const expected = `"${body.version}"`;
  const actual = response.headers().etag;
  if (actual !== expected) {
    throw new Error(
      `${operation} returned ETag ${actual ?? "missing"} for version ${body.version}.`,
    );
  }
  return actual;
}

function assertPreferences(actual, expected, operation) {
  if (!preferencesMatch(actual, expected)) {
    throw new Error(
      `Notification preference ${operation} did not match the canonical fake-local state.`,
    );
  }
  if (!Number.isSafeInteger(actual.version) || actual.version < 1) {
    throw new Error(
      `Notification preference ${operation} returned invalid version metadata.`,
    );
  }
}

function preferencesMatch(actual, expected) {
  const projection = {
    enabled: actual.enabled,
    inAppEnabled: actual.inAppEnabled,
    emailEnabled: actual.emailEnabled,
    timezone: actual.timezone,
    quietHoursEnabled: actual.quietHoursEnabled,
    quietStart: actual.quietStart,
    quietEnd: actual.quietEnd,
  };
  return JSON.stringify(projection) === JSON.stringify(expected);
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) {
    throw new Error("A reminder-rule resource omitted its rules.");
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

async function assertLocalStackReady() {
  await Promise.all([
    waitForHttp("http://localhost:3000/signin", 60_000),
    waitForHttp("http://localhost:8080/actuator/health/readiness", 60_000),
    waitForHttp(
      "http://localhost:8081/realms/autopay-guard/.well-known/openid-configuration",
      60_000,
    ),
    waitForHttp("http://localhost:8025/readyz", 60_000),
  ]);
}

async function ensureMailpitUp() {
  await runDockerCompose([
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "90",
    "mailpit",
  ]);
  await waitForHttp("http://localhost:8025/readyz", 60_000);
}

async function stopMailpit() {
  await runDockerCompose(["stop", "mailpit"]);
}

async function waitForMailpitUnavailable() {
  const deadline = Date.now() + 30_000;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch("http://localhost:8025/readyz", {
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) {
        return;
      }
    } catch {
      return;
    }
    await sleep(500);
  }
  throw new Error("Mailpit remained reachable after the bounded Compose stop.");
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok || response.status === 302) {
        return;
      }
    } catch {
      // The bounded readiness loop reports one generic failure at timeout.
    }
    await sleep(1_000);
  }
  throw new Error(`The required loopback service was not ready: ${url}.`);
}

async function runDockerCompose(commandArguments) {
  const safeCommands = new Set(["up", "stop"]);
  if (!safeCommands.has(commandArguments[0])) {
    throw new Error(
      "The live acceptance runner refused an unsafe Compose command.",
    );
  }
  const args = [
    "compose",
    "--project-name",
    "autopay-guard",
    "--file",
    composeFile,
    ...commandArguments,
  ];
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(dockerExecutable, args, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DOCKER_CONFIG: dockerConfigDirectory,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-16_384);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `The bounded Docker Compose ${commandArguments[0]} command failed with code ${code}: ${output.trim()}`,
          ),
        );
      }
    });
  });
}

async function waitForAnotherGeneratorCycle() {
  const nextMinute = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
  await sleep(Math.max(0, nextMinute + 15_000 - Date.now()));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function validateEnvironment() {
  requireExactEnvironment("RUN_MILESTONE3_LIVE_ACCEPTANCE", acknowledgement);
  requireExactEnvironment("COMPOSE_PROJECT_NAME", "autopay-guard");
  requireExactEnvironment("TZ", "Asia/Kolkata");
  requireExactEnvironment("WEB_PORT", "3000");
  requireExactEnvironment("API_PORT", "8080");
  requireExactEnvironment("KEYCLOAK_PORT", "8081");
  requireExactEnvironment("MAILPIT_SMTP_PORT", "1025");
  requireExactEnvironment("MAILPIT_UI_PORT", "8025");
  requireExactEnvironment("KEYCLOAK_FAKE_USER_USERNAME", canonicalFakeEmail);
  requireExactEnvironment("AUTH_URL", "http://localhost:3000");
  requireExactEnvironment(
    "AUTH_KEYCLOAK_ISSUER",
    "http://localhost:8081/realms/autopay-guard",
  );
  requireExactEnvironment(
    "OIDC_ISSUER_URI",
    "http://localhost:8081/realms/autopay-guard",
  );
  requireExactEnvironment("API_BASE_URL", "http://localhost:8080");
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required for the guarded Milestone 3 live acceptance.`,
    );
  }
  return value;
}

function requireExactEnvironment(name, expected) {
  const actual = requiredEnvironment(name);
  if (actual !== expected) {
    throw new Error(
      `${name} must be exactly ${expected} for the canonical local-only acceptance environment.`,
    );
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
        `Another Milestone 3 live acceptance may be running. After verifying no runner is active, remove the stale lock at ${lockPath}.`,
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
    if (!current) {
      return;
    }
    const owner = JSON.parse(current);
    if (owner.token === token) {
      await rm(lockPath, { force: true });
    }
  };
}
