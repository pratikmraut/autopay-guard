import { chromium } from "@playwright/test";
import { open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const acknowledgement = "I_ACKNOWLEDGE_LOCAL_FAKE_M4_ACCEPTANCE";
const canonicalFakeEmail = "demo@autopayguard.local";
const reservedNames = new Set([
  "M4 Live Self Report",
  "M4 Live Unsafe Feedback",
  "M4 Live Conflict",
]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const fixturePath = join(
  repositoryRoot,
  "infra",
  "local",
  "fixtures",
  "milestone4.json",
);
const lockPath = join(
  tmpdir(),
  "autopay-guard-milestone4-live-acceptance.lock",
);
const baseUrl = "http://localhost:3000";

validateEnvironment();
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const fakePassword = requiredEnvironment("KEYCLOAK_FAKE_USER_PASSWORD");
const liveGuides = new Map([
  ["M4 Live Self Report", fixture.guides[17]],
  ["M4 Live Conflict", fixture.guides[18]],
  ["M4 Live Unsafe Feedback", fixture.guides[19]],
]);
if (
  fixture.fixtureVersion !== 1 ||
  fixture.guides.length !== 20 ||
  [...liveGuides.values()].map(({ category }) => category).join(",") !==
    "SOFTWARE,SUBSCRIPTION,MEMBERSHIP" ||
  [...liveGuides.values()].some(
    (guide) =>
      !guide ||
      !/^service(?:18|19|20)\.example$/.test(guide.host) ||
      !/^10000000-0000-4000-8000-0000000000(?:18|19|20)$/.test(
        guide.merchantId,
      ),
  )
) {
  throw new Error("The guarded M4 live fixture allocation is invalid.");
}

const releaseLock = await acquireLock();
let browser;
let page;
let household = null;
let primaryFailure = null;

try {
  await assertLocalStackReady();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: baseUrl });
  page = await context.newPage();
  await signIn(page);
  await readCanonicalUser(page);
  household = await resolveOldestHousehold(page);
  await cleanupReservedState(page, household.id);

  await exerciseSelfReportedFlow(page, household);
  await exerciseStaleConflict(page, household);
  await exerciseUnsafeFeedback(page, household);

  console.log(
    "Milestone 4 guarded live acceptance passed: idempotent decision/attempt creation, separate tracks, self-report, stale ETag conflict, unsafe-target suppression, savings separation, and cleanup.",
  );
} catch (error) {
  primaryFailure = error;
} finally {
  const cleanupFailures = [];
  if (page && household) {
    try {
      await cleanupReservedState(page, household.id);
      await assertCanonicalDashboard(page, household);
    } catch (error) {
      cleanupFailures.push(
        new Error("Milestone 4 reserved-state cleanup failed.", {
          cause: error,
        }),
      );
    }
  }
  await browser?.close().catch((error) => cleanupFailures.push(error));
  await releaseLock().catch((error) => cleanupFailures.push(error));
  if (primaryFailure || cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures].filter(Boolean),
      "Milestone 4 guarded live acceptance failed.",
    );
  }
}

async function exerciseSelfReportedFlow(authenticatedPage, selectedHousehold) {
  const commitment = await createReservedCommitment(
    authenticatedPage,
    selectedHousehold,
    "M4 Live Self Report",
    65000,
    5,
  );
  const occurrence = await findDecisionOccurrence(
    authenticatedPage,
    selectedHousehold,
    commitment,
  );
  const decisionKey = idempotencyKey("m4-live-decision");
  const firstDecision = await createDecision(
    authenticatedPage,
    occurrence.id,
    decisionKey,
    "CANCEL_WITH_PROVIDER",
  );
  const replayedDecision = await createDecision(
    authenticatedPage,
    occurrence.id,
    decisionKey,
    "CANCEL_WITH_PROVIDER",
  );
  if (
    JSON.stringify(firstDecision) !== JSON.stringify(replayedDecision) ||
    firstDecision.decision !== "CANCEL_WITH_PROVIDER" ||
    firstDecision.occurrenceId !== occurrence.id
  ) {
    throw new Error("A decision idempotency replay was not stable.");
  }
  await api(
    authenticatedPage,
    "POST",
    `/v1/occurrences/${occurrence.id}/decisions`,
    {
      expectedStatus: 409,
      headers: { "idempotency-key": decisionKey },
      data: { decision: "KEEP" },
    },
  );

  const guide = await getGuide(authenticatedPage, commitment.id);
  assertGuideAllocation(
    guide,
    commitment,
    liveGuides.get(commitment.displayName),
  );
  const attemptKey = idempotencyKey("m4-live-attempt");
  const attemptBody = {
    occurrenceId: occurrence.id,
    decisionId: firstDecision.id,
    guideId: guide.id,
    guideVersion: guide.version,
    note: "Fake-local live acceptance only.",
  };
  const firstAttemptResponse = await api(
    authenticatedPage,
    "POST",
    `/v1/commitments/${commitment.id}/cancellation-attempts`,
    {
      expectedStatus: 201,
      headers: { "idempotency-key": attemptKey },
      data: attemptBody,
    },
  );
  const firstAttempt = await firstAttemptResponse.json();
  assertAttempt(firstAttempt, commitment, occurrence, "PENDING");
  assertVersionAndEtag(firstAttemptResponse, firstAttempt, "attempt creation");
  const replayResponse = await api(
    authenticatedPage,
    "POST",
    `/v1/commitments/${commitment.id}/cancellation-attempts`,
    {
      expectedStatus: 201,
      headers: { "idempotency-key": attemptKey },
      data: attemptBody,
    },
  );
  const replay = await replayResponse.json();
  if (JSON.stringify(firstAttempt) !== JSON.stringify(replay)) {
    throw new Error("An attempt idempotency replay was not stable.");
  }

  const completedResponse = await api(
    authenticatedPage,
    "PATCH",
    `/v1/cancellation-attempts/${firstAttempt.id}`,
    {
      expectedStatus: 200,
      headers: { "if-match": `"${firstAttempt.version}"` },
      data: {
        serviceStatus: "CONFIRMED",
        paymentMandateStatus: "CONFIRMED",
        abandoned: false,
      },
    },
  );
  const completed = await completedResponse.json();
  if (
    completed.serviceStatus !== "CONFIRMED" ||
    completed.paymentMandateStatus !== "CONFIRMED" ||
    !completed.completedAt ||
    completed.verificationStatus !== "PENDING"
  ) {
    throw new Error(
      "Completing the two independent tracks returned an invalid state.",
    );
  }
  assertVersionAndEtag(completedResponse, completed, "track completion");

  const verificationKey = idempotencyKey("m4-live-self-report");
  const selfReportedResponse = await api(
    authenticatedPage,
    "POST",
    `/v1/cancellation-attempts/${completed.id}/verify`,
    {
      expectedStatus: 200,
      headers: {
        "if-match": `"${completed.version}"`,
        "idempotency-key": verificationKey,
      },
      data: { status: "SELF_REPORTED" },
    },
  );
  const selfReported = await selfReportedResponse.json();
  if (
    selfReported.verificationStatus !== "SELF_REPORTED" ||
    selfReported.abandoned !== false
  ) {
    throw new Error(
      "The live outcome was not retained as self-reported external steps.",
    );
  }
  assertVersionAndEtag(
    selfReportedResponse,
    selfReported,
    "self-reported outcome",
  );
  await assertSavingsCurrentState(
    authenticatedPage,
    selectedHousehold.id,
    selfReported,
    "SELF_REPORTED",
  );

  const lateAttemptReplayResponse = await api(
    authenticatedPage,
    "POST",
    `/v1/commitments/${commitment.id}/cancellation-attempts`,
    {
      expectedStatus: 201,
      headers: { "idempotency-key": attemptKey },
      data: attemptBody,
    },
  );
  const lateAttemptReplay = await lateAttemptReplayResponse.json();
  if (JSON.stringify(lateAttemptReplay) !== JSON.stringify(firstAttempt)) {
    throw new Error(
      "A late attempt replay returned mutable current state instead of the original response.",
    );
  }
  assertVersionAndEtag(
    lateAttemptReplayResponse,
    lateAttemptReplay,
    "late attempt replay",
  );

  const abandonedResponse = await api(
    authenticatedPage,
    "PATCH",
    `/v1/cancellation-attempts/${selfReported.id}`,
    {
      expectedStatus: 200,
      headers: { "if-match": `"${selfReported.version}"` },
      data: {
        serviceStatus: selfReported.serviceStatus,
        paymentMandateStatus: selfReported.paymentMandateStatus,
        abandoned: true,
      },
    },
  );
  const abandoned = await abandonedResponse.json();
  if (!abandoned.abandoned) {
    throw new Error("The self-reported live attempt was not abandoned.");
  }
  assertVersionAndEtag(
    abandonedResponse,
    abandoned,
    "self-reported attempt abandonment",
  );
  await assertSavingsCurrentState(
    authenticatedPage,
    selectedHousehold.id,
    abandoned,
    "REVERSED",
  );

  const lateVerificationReplayResponse = await api(
    authenticatedPage,
    "POST",
    `/v1/cancellation-attempts/${completed.id}/verify`,
    {
      expectedStatus: 200,
      headers: {
        "if-match": `"${completed.version}"`,
        "idempotency-key": verificationKey,
      },
      data: { status: "SELF_REPORTED" },
    },
  );
  const lateVerificationReplay = await lateVerificationReplayResponse.json();
  if (JSON.stringify(lateVerificationReplay) !== JSON.stringify(selfReported)) {
    throw new Error(
      "A late verification replay returned mutable current state instead of the original response.",
    );
  }
  assertVersionAndEtag(
    lateVerificationReplayResponse,
    lateVerificationReplay,
    "late verification replay",
  );
}

async function exerciseStaleConflict(authenticatedPage, selectedHousehold) {
  const commitment = await createReservedCommitment(
    authenticatedPage,
    selectedHousehold,
    "M4 Live Conflict",
    70000,
    6,
  );
  const occurrence = await findDecisionOccurrence(
    authenticatedPage,
    selectedHousehold,
    commitment,
  );
  const decision = await createDecision(
    authenticatedPage,
    occurrence.id,
    idempotencyKey("m4-conflict-decision"),
    "CANCEL_WITH_PROVIDER",
  );
  const guide = await getGuide(authenticatedPage, commitment.id);
  assertGuideAllocation(
    guide,
    commitment,
    liveGuides.get(commitment.displayName),
  );
  const attemptResponse = await api(
    authenticatedPage,
    "POST",
    `/v1/commitments/${commitment.id}/cancellation-attempts`,
    {
      expectedStatus: 201,
      headers: {
        "idempotency-key": idempotencyKey("m4-conflict-attempt"),
      },
      data: {
        occurrenceId: occurrence.id,
        decisionId: decision.id,
        guideId: guide.id,
        guideVersion: guide.version,
        note: null,
      },
    },
  );
  const attempt = await attemptResponse.json();
  const staleEtag = assertVersionAndEtag(
    attemptResponse,
    attempt,
    "conflict attempt creation",
  );

  const firstWriterResponse = await api(
    authenticatedPage,
    "PATCH",
    `/v1/cancellation-attempts/${attempt.id}`,
    {
      expectedStatus: 200,
      headers: { "if-match": staleEtag },
      data: {
        serviceStatus: "REQUESTED",
        paymentMandateStatus: "NOT_STARTED",
        abandoned: false,
      },
    },
  );
  const firstWriter = await firstWriterResponse.json();
  assertVersionAndEtag(
    firstWriterResponse,
    firstWriter,
    "first conflict writer",
  );

  const staleResponse = await api(
    authenticatedPage,
    "PATCH",
    `/v1/cancellation-attempts/${attempt.id}`,
    {
      expectedStatus: 412,
      headers: { "if-match": staleEtag },
      data: {
        serviceStatus: "CONFIRMED",
        paymentMandateStatus: "CONFIRMED",
        abandoned: false,
      },
    },
  );
  const staleProblem = await staleResponse.json();
  if (
    staleProblem.status !== 412 ||
    JSON.stringify(staleProblem).includes("REQUESTED") ||
    JSON.stringify(staleProblem).includes("CONFIRMED")
  ) {
    throw new Error(
      "The stale-write response was not a safe precondition failure.",
    );
  }
  const latest = await getAttempt(authenticatedPage, attempt.id);
  if (
    latest.body.version !== firstWriter.version ||
    latest.body.serviceStatus !== "REQUESTED" ||
    latest.body.paymentMandateStatus !== "NOT_STARTED"
  ) {
    throw new Error("A stale writer changed the live cancellation attempt.");
  }
}

async function exerciseUnsafeFeedback(authenticatedPage, selectedHousehold) {
  const commitment = await createReservedCommitment(
    authenticatedPage,
    selectedHousehold,
    "M4 Live Unsafe Feedback",
    75000,
    7,
  );
  const occurrence = await findDecisionOccurrence(
    authenticatedPage,
    selectedHousehold,
    commitment,
  );
  const decision = await createDecision(
    authenticatedPage,
    occurrence.id,
    idempotencyKey("m4-unsafe-decision"),
    "CANCEL_WITH_PROVIDER",
  );
  const guide = await getGuide(authenticatedPage, commitment.id);
  if (!guide.targetsSuppressed) {
    assertGuideAllocation(
      guide,
      commitment,
      liveGuides.get(commitment.displayName),
    );
  } else if (
    guide.targetSuppressionReason !== "USER_REPORTED_UNSAFE" ||
    guide.id !== liveGuides.get(commitment.displayName).guideId
  ) {
    throw new Error(
      "The repeat live run encountered an unexpected target-suppression reason.",
    );
  }
  const feedbackKey = idempotencyKey("m4-unsafe-feedback");
  const feedbackBody = {
    commitmentId: commitment.id,
    guideVersion: guide.version,
    outcome: "UNSAFE_LINK",
    note: "Fictional unsafe-link acceptance report.",
  };
  await api(
    authenticatedPage,
    "POST",
    `/v1/cancellation-guides/${guide.id}/feedback`,
    {
      expectedStatus: 204,
      headers: { "idempotency-key": feedbackKey },
      data: feedbackBody,
    },
  );
  await api(
    authenticatedPage,
    "POST",
    `/v1/cancellation-guides/${guide.id}/feedback`,
    {
      expectedStatus: 204,
      headers: { "idempotency-key": feedbackKey },
      data: feedbackBody,
    },
  );
  await api(
    authenticatedPage,
    "POST",
    `/v1/cancellation-guides/${guide.id}/feedback`,
    {
      expectedStatus: 409,
      headers: { "idempotency-key": feedbackKey },
      data: { ...feedbackBody, outcome: "WORKED" },
    },
  );
  const suppressed = await getGuide(authenticatedPage, commitment.id);
  if (
    suppressed.targetsSuppressed !== true ||
    suppressed.targetSuppressionReason !== "USER_REPORTED_UNSAFE" ||
    suppressed.tracks.some(({ steps }) =>
      steps.some((step) => step.kind !== "INFORMATION" && step.target !== null),
    )
  ) {
    throw new Error(
      "Unsafe-link feedback did not suppress every actionable target.",
    );
  }
  await api(
    authenticatedPage,
    "POST",
    `/v1/commitments/${commitment.id}/cancellation-attempts`,
    {
      expectedStatus: 409,
      headers: {
        "idempotency-key": idempotencyKey("m4-unsafe-blocked-attempt"),
      },
      data: {
        occurrenceId: occurrence.id,
        decisionId: decision.id,
        guideId: guide.id,
        guideVersion: guide.version,
        note: null,
      },
    },
  );
}

async function createReservedCommitment(
  authenticatedPage,
  selectedHousehold,
  displayName,
  amountMinor,
  dueInDays,
) {
  if (!reservedNames.has(displayName)) {
    throw new Error("Refusing to create a non-reserved M4 live commitment.");
  }
  const guide = liveGuides.get(displayName);
  const anchorDate = addDays(
    localDateInTimeZone(selectedHousehold.timezone),
    dueInDays,
  );
  const response = await api(authenticatedPage, "POST", "/v1/commitments", {
    expectedStatus: 201,
    data: {
      householdId: selectedHousehold.id,
      merchantId: guide.merchantId,
      displayName,
      category: guide.category,
      paymentRail: "CARD_RECURRING",
      amountMinor,
      estimatedAmountMinor: null,
      currency: "INR",
      frequency: "MONTHLY",
      intervalCount: 1,
      customIntervalUnit: null,
      anchorDate,
      monthDayPolicy: "ANCHOR_DAY",
      variableAmount: false,
      maskedPaymentLabel: null,
    },
  });
  const body = await response.json();
  if (
    body.householdId !== selectedHousehold.id ||
    body.merchantId !== guide.merchantId ||
    body.displayName !== displayName ||
    body.status !== "ACTIVE" ||
    body.amountMinor !== amountMinor ||
    body.currency !== "INR" ||
    body.nextDueDate !== anchorDate
  ) {
    throw new Error("A reserved M4 live commitment returned unexpected state.");
  }
  assertVersionAndEtag(response, body, "reserved commitment creation");
  return body;
}

async function findDecisionOccurrence(
  authenticatedPage,
  selectedHousehold,
  commitment,
) {
  const from = localDateInTimeZone(selectedHousehold.timezone);
  const to = addDays(from, 30);
  const query = new URLSearchParams({
    householdId: selectedHousehold.id,
    from,
    to,
    limit: "100",
  });
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/decisions/inbox?${query.toString()}`,
  );
  const body = await response.json();
  const matches = body.items?.filter(
    (item) =>
      item.commitmentId === commitment.id &&
      item.displayName === commitment.displayName &&
      item.scheduledDate === commitment.nextDueDate,
  );
  if (
    body.householdId !== selectedHousehold.id ||
    body.from !== from ||
    body.to !== to ||
    matches?.length !== 1 ||
    !matches[0].reviewActions.includes("CANCEL_WITH_PROVIDER")
  ) {
    throw new Error(
      `The decision inbox did not return the reserved occurrence for ${commitment.displayName}.`,
    );
  }
  return { ...matches[0], id: matches[0].occurrenceId };
}

async function createDecision(authenticatedPage, occurrenceId, key, decision) {
  const response = await api(
    authenticatedPage,
    "POST",
    `/v1/occurrences/${occurrenceId}/decisions`,
    {
      expectedStatus: 201,
      headers: { "idempotency-key": key },
      data: { decision },
    },
  );
  return response.json();
}

async function getGuide(authenticatedPage, commitmentId) {
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/commitments/${commitmentId}/cancellation-guide`,
  );
  return response.json();
}

function assertGuideAllocation(guide, commitment, expected) {
  const serviceTarget = guide.tracks
    ?.find(({ track }) => track === "SERVICE")
    ?.steps.find(({ kind }) => kind === "SAFE_LINK")?.target?.uri;
  const mandateTarget = guide.tracks
    ?.find(({ track }) => track === "PAYMENT_MANDATE")
    ?.steps.find(({ kind }) => kind === "APP_DEEP_LINK")?.target?.uri;
  if (
    guide.id !== expected.guideId ||
    guide.commitmentId !== commitment.id ||
    guide.merchantName !== expected.merchantName ||
    guide.version !== 1 ||
    guide.status !== "PUBLISHED" ||
    guide.freshness !== "CURRENT" ||
    guide.targetsSuppressed !== false ||
    serviceTarget !== `https://${expected.host}/manage/subscription` ||
    mandateTarget !== "autopayguard-demo://mandates/service/manage"
  ) {
    throw new Error(
      `The live guide allocation for ${commitment.displayName} was invalid.`,
    );
  }
}

function assertAttempt(attempt, commitment, occurrence, verificationStatus) {
  if (
    attempt.commitmentId !== commitment.id ||
    attempt.occurrenceId !== occurrence.id ||
    attempt.scheduledDate !== occurrence.scheduledDate ||
    attempt.currency !== "INR" ||
    attempt.amountKind !== "FIXED" ||
    attempt.projectedSavingsMinor !== commitment.amountMinor * 12 ||
    attempt.estimated !== false ||
    attempt.serviceStatus !== "NOT_STARTED" ||
    attempt.paymentMandateStatus !== "NOT_STARTED" ||
    attempt.verificationStatus !== verificationStatus ||
    attempt.abandoned !== false
  ) {
    throw new Error("A cancellation attempt snapshot was not deterministic.");
  }
}

async function getAttempt(authenticatedPage, attemptId) {
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/cancellation-attempts/${attemptId}`,
  );
  const body = await response.json();
  return {
    body,
    etag: assertVersionAndEtag(response, body, "attempt GET"),
  };
}

async function assertSavingsCurrentState(
  authenticatedPage,
  householdId,
  attempt,
  expectedState,
) {
  const query = new URLSearchParams({ householdId, limit: "100" });
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/savings?${query.toString()}`,
  );
  const body = await response.json();
  const matches = body.items?.filter((item) => item.attemptId === attempt.id);
  const currency = body.currencies?.find(
    (candidate) => candidate.currency === attempt.currency,
  );
  const stateTotal = currency?.totals?.find(
    ({ state }) => state === expectedState,
  );
  const amountField = attempt.estimated
    ? "estimatedAmountMinor"
    : "exactAmountMinor";
  const countField = attempt.estimated
    ? "estimatedAttemptCount"
    : "exactAttemptCount";
  if (
    body.householdId !== householdId ||
    matches?.length !== 1 ||
    matches[0].state !== expectedState ||
    matches[0].amountMinor !== attempt.projectedSavingsMinor ||
    matches[0].estimated !== attempt.estimated ||
    !stateTotal ||
    "amountMinor" in stateTotal ||
    "attemptCount" in stateTotal ||
    stateTotal[amountField] < attempt.projectedSavingsMinor ||
    stateTotal[countField] < 1 ||
    currency.totals.some(
      ({ state }) =>
        state !== expectedState &&
        body.items.some(
          (item) => item.attemptId === attempt.id && item.state === state,
        ),
    )
  ) {
    throw new Error(
      "The savings view did not keep the attempt in exactly one current state.",
    );
  }
}

async function cleanupReservedState(authenticatedPage, householdId) {
  const commitments = await listCommitments(
    authenticatedPage,
    householdId,
    false,
  );
  for (const commitment of commitments) {
    if (!reservedNames.has(commitment.displayName)) {
      continue;
    }
    await abandonUnresolvedAttempts(
      authenticatedPage,
      householdId,
      commitment.id,
    );
    await archiveCommitment(authenticatedPage, commitment.id);
  }
  const remaining = await listCommitments(
    authenticatedPage,
    householdId,
    false,
  );
  if (remaining.some(({ displayName }) => reservedNames.has(displayName))) {
    throw new Error("A reserved M4 live commitment remained active.");
  }
  await assertNoUnresolvedReservedAttempts(authenticatedPage, householdId);
}

async function abandonUnresolvedAttempts(
  authenticatedPage,
  householdId,
  commitmentId,
) {
  const query = new URLSearchParams({ householdId, limit: "100" });
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/commitments/${commitmentId}/cancellation-attempts?${query.toString()}`,
  );
  const body = await response.json();
  for (const summary of body.items ?? []) {
    const current = await getAttempt(authenticatedPage, summary.id);
    if (
      current.body.abandoned ||
      current.body.verificationStatus === "VERIFIED" ||
      current.body.verificationStatus === "DISPUTED"
    ) {
      continue;
    }
    const abandonedResponse = await api(
      authenticatedPage,
      "PATCH",
      `/v1/cancellation-attempts/${current.body.id}`,
      {
        expectedStatus: 200,
        headers: { "if-match": current.etag },
        data: {
          serviceStatus: current.body.serviceStatus,
          paymentMandateStatus: current.body.paymentMandateStatus,
          abandoned: true,
        },
      },
    );
    const abandoned = await abandonedResponse.json();
    if (!abandoned.abandoned) {
      throw new Error("An unresolved reserved attempt was not abandoned.");
    }
    assertVersionAndEtag(
      abandonedResponse,
      abandoned,
      "reserved attempt abandonment",
    );
    if (abandoned.projectedSavingsMinor !== null) {
      await assertSavingsCurrentState(
        authenticatedPage,
        householdId,
        abandoned,
        "REVERSED",
      );
    }
  }
}

async function assertNoUnresolvedReservedAttempts(
  authenticatedPage,
  householdId,
) {
  const commitments = await listCommitments(
    authenticatedPage,
    householdId,
    true,
  );
  for (const commitment of commitments) {
    if (!reservedNames.has(commitment.displayName)) {
      continue;
    }
    const query = new URLSearchParams({ householdId, limit: "100" });
    const response = await api(
      authenticatedPage,
      "GET",
      `/v1/commitments/${commitment.id}/cancellation-attempts?${query.toString()}`,
    );
    const body = await response.json();
    if (
      body.items?.some(
        (attempt) =>
          !attempt.abandoned &&
          attempt.verificationStatus !== "VERIFIED" &&
          attempt.verificationStatus !== "DISPUTED",
      )
    ) {
      throw new Error(
        "An unresolved reserved M4 attempt remained after cleanup.",
      );
    }
  }
}

async function archiveCommitment(authenticatedPage, commitmentId) {
  const path = `/v1/commitments/${commitmentId}`;
  const response = await api(authenticatedPage, "GET", path, {
    expectedStatus: [200, 404],
  });
  if (response.status() === 404) {
    return;
  }
  const body = await response.json();
  if (body.status === "ARCHIVED") {
    return;
  }
  const etag = assertVersionAndEtag(
    response,
    body,
    "reserved commitment cleanup",
  );
  await api(authenticatedPage, "DELETE", path, {
    expectedStatus: 204,
    headers: { "if-match": etag },
  });
}

async function listCommitments(
  authenticatedPage,
  householdId,
  includeArchived,
) {
  const items = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({
      householdId,
      includeArchived: String(includeArchived),
      limit: "100",
    });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const response = await api(
      authenticatedPage,
      "GET",
      `/v1/commitments?${query.toString()}`,
    );
    const body = await response.json();
    if (!Array.isArray(body.items)) {
      throw new Error("The commitment collection was invalid.");
    }
    items.push(...body.items);
    cursor = body.nextCursor ?? null;
  } while (cursor);
  return items;
}

async function assertCanonicalDashboard(authenticatedPage, selectedHousehold) {
  const month = localDateInTimeZone(selectedHousehold.timezone).slice(0, 7);
  const query = new URLSearchParams({
    householdId: selectedHousehold.id,
    month,
  });
  const response = await api(
    authenticatedPage,
    "GET",
    `/v1/dashboard/summary?${query.toString()}`,
  );
  const summary = await response.json();
  const monthly = summary.monthlyProjection?.totals;
  const annual = summary.annualizedProjection?.totals;
  if (
    summary.activeCommitmentCount !== 4 ||
    monthly?.length !== 1 ||
    monthly[0].currency !== "INR" ||
    monthly[0].knownTotalMinor !== 450000 ||
    annual?.length !== 1 ||
    annual[0].currency !== "INR" ||
    annual[0].knownTotalMinor !== 5400000
  ) {
    throw new Error(
      "Cleanup did not restore the canonical INR 4,500 monthly and INR 54,000 forward projection.",
    );
  }
}

async function readCanonicalUser(authenticatedPage) {
  const response = await api(authenticatedPage, "GET", "/v1/me");
  const body = await response.json();
  if (
    body.email !== canonicalFakeEmail ||
    body.displayName !== "Demo User" ||
    body.timezone !== "Asia/Kolkata" ||
    body.ageConfirmed !== true ||
    body.privacyNoticeAccepted !== true
  ) {
    throw new Error(
      "Refusing to run against anything except the canonical onboarded fake identity.",
    );
  }
}

async function resolveOldestHousehold(authenticatedPage) {
  const response = await api(authenticatedPage, "GET", "/v1/households");
  const body = await response.json();
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error("The canonical fake identity has no owned household.");
  }
  const household = [...body.items].sort((left, right) =>
    `${left.createdAt}:${left.id}`.localeCompare(
      `${right.createdAt}:${right.id}`,
    ),
  )[0];
  if (household.defaultCurrency !== "INR") {
    throw new Error(
      "The oldest fake household is not the canonical INR scope.",
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

async function assertLocalStackReady() {
  const checks = [
    ["web", `${baseUrl}/signin`],
    ["API", "http://localhost:8080/actuator/health/readiness"],
    [
      "Keycloak",
      "http://localhost:8081/realms/autopay-guard/.well-known/openid-configuration",
    ],
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
  if (process.env.M4_LIVE_ACCEPTANCE_ACK !== acknowledgement) {
    throw new Error(
      `Set M4_LIVE_ACCEPTANCE_ACK=${acknowledgement} to confirm this guarded fake-local mutation.`,
    );
  }
  if (requiredEnvironment("COMPOSE_PROJECT_NAME") !== "autopay-guard") {
    throw new Error("Refusing to use an unexpected Compose project.");
  }
  if (requiredEnvironment("AUTH_URL") !== baseUrl) {
    throw new Error("M4 live acceptance requires AUTH_URL on localhost:3000.");
  }
  if (
    requiredEnvironment("AUTH_KEYCLOAK_ISSUER") !==
    "http://localhost:8081/realms/autopay-guard"
  ) {
    throw new Error(
      "M4 live acceptance requires the canonical local Keycloak issuer.",
    );
  }
  if (
    requiredEnvironment("KEYCLOAK_FAKE_USER_USERNAME") !== canonicalFakeEmail
  ) {
    throw new Error("M4 live acceptance requires the canonical fake identity.");
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Milestone 4 live acceptance.`);
  }
  return value;
}

function idempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function localDateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(localDate, days) {
  const value = new Date(`${localDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function acquireLock() {
  const token = crypto.randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another M4 live verifier may be running. After checking processes, remove the stale lock at ${lockPath}.`,
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
