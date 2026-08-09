import {
  bffRequest,
  boundedJson,
  idempotencyKey,
  loadChromium,
  makeCsv,
  operationActorKey,
  postgres,
  requireUuid,
  restartCanonicalApi,
  responseEtag,
  safeAlphabeticToken,
  signInOwner,
  validateM6NodeEnvironment,
} from "./lib/m6-browser.mjs";

validateM6NodeEnvironment();

const chromium = loadChromium();
const runStartedAt = new Date().toISOString();
const reservedPrefix = `M6 Live Fixture ${safeAlphabeticToken()}`;
const createdJobIds = new Set();
let ownerUserId = null;
let browser;
let session;
let primaryFailure = null;

try {
  browser = await chromium.launch({ headless: true });
  session = await signInOwner(browser);
  const request = session.context.request;

  const me = await expectJson(request, "GET", "/v1/me", 200, "identity");
  ownerUserId = requireUuid(me.body.id, "owner user ID");

  const households = await expectJson(
    request,
    "GET",
    "/v1/households?limit=100",
    200,
    "household list",
  );
  const ownedHouseholds = arrayItems(households.body).filter(
    (household) =>
      household.canManage === true || household.accessRole === "OWNER",
  );
  if (ownedHouseholds.length !== 1) {
    throw new Error(
      "The canonical owner must have exactly one managed household.",
    );
  }
  const householdId = requireUuid(
    ownedHouseholds[0].id,
    "canonical household ID",
  );

  const commitmentsBefore = await listCommitments(request, householdId);
  assertCanonicalCommitments(commitmentsBefore);
  const existing = commitmentsBefore.find(
    (commitment) =>
      commitment.displayName === "M2 Fixture StreamBox Demo" &&
      commitment.status === "ACTIVE" &&
      commitment.variableAmount === false,
  );
  if (!existing || existing.amountMinor == null || !existing.nextDueDate) {
    throw new Error("The canonical fixed duplicate fixture is unavailable.");
  }

  const uniqueRow = {
    name: reservedPrefix,
    category: "SUBSCRIPTION",
    amount: "321.00",
    currency: "INR",
    frequency: "YEARLY",
    nextDueDate: "2099-12-31",
    paymentRail: "CASH_OR_MANUAL",
    maskedPaymentLabel: "Local test label",
  };
  const existingRow = {
    name: existing.displayName,
    category: existing.category,
    amount: minorToRupees(existing.amountMinor),
    currency: existing.currency,
    frequency: existing.frequency,
    nextDueDate: existing.nextDueDate,
    paymentRail: existing.paymentRail,
    maskedPaymentLabel: existing.maskedPaymentLabel ?? "",
  };
  const invalidRow = {
    name: `${reservedPrefix} Invalid`,
    category: "NOT_A_CATEGORY",
    amount: "12.00",
    currency: "INR",
    frequency: "MONTHLY",
    nextDueDate: "2099-10-10",
    paymentRail: "CASH_OR_MANUAL",
    maskedPaymentLabel: "",
  };
  const fixture = makeCsv([
    uniqueRow,
    { ...uniqueRow },
    existingRow,
    invalidRow,
  ]);
  if (fixture.byteLength > 256 * 1024) {
    throw new Error("The controlled live fixture exceeded the upload limit.");
  }

  const uploadKey = idempotencyKey("live-upload");
  const upload = await uploadCsv(
    request,
    householdId,
    fixture,
    `${safeAlphabeticToken()}.csv`,
    uploadKey,
  );
  assertUploadSummary(upload.body, {
    total: 4,
    valid: 3,
    invalid: 1,
    duplicates: 2,
  });
  createdJobIds.add(requireUuid(upload.body.id, "import job ID"));
  const uploadEtag = responseEtag(upload.response, upload.body.version);

  const replay = await uploadCsv(
    request,
    householdId,
    fixture,
    `${safeAlphabeticToken()}.csv`,
    uploadKey,
    // The request fingerprint intentionally includes content, household, and
    // the normalized file contract, not a disposable verifier filename.
  );
  if (
    replay.body.id !== upload.body.id ||
    replay.body.version !== upload.body.version
  ) {
    throw new Error("Same-key/same-upload replay was not stable.");
  }
  responseEtag(replay.response, replay.body.version);

  const previewRead = await expectJson(
    request,
    "GET",
    `/v1/imports/${upload.body.id}`,
    200,
    "import preview read",
  );
  if (
    previewRead.response.headers()["cache-control"] !== "no-store" ||
    previewRead.body.id !== upload.body.id
  ) {
    throw new Error("Import preview cache or identity policy failed.");
  }
  assertPreview(previewRead.body, {
    total: 4,
    valid: 3,
    invalid: 1,
    duplicates: 2,
  });
  const previewEtag = responseEtag(
    previewRead.response,
    previewRead.body.version,
  );
  if (previewEtag !== uploadEtag) {
    throw new Error("An unchanged preview did not preserve its upload ETag.");
  }
  const previewRawState = await postgres(
    `SELECT (raw_payload IS NULL) || '|' || (raw_processed_at IS NOT NULL)
       FROM commitment_import_jobs
      WHERE id = '${upload.body.id}'::uuid;`,
  );
  if (previewRawState !== "true|true") {
    throw new Error(
      "The preview committed raw CSV instead of the zero-persistence state.",
    );
  }

  const commitmentsDuringPreview = await listCommitments(request, householdId);
  if (
    commitmentsDuringPreview.some(
      (commitment) => commitment.displayName === reservedPrefix,
    )
  ) {
    throw new Error(
      "Preview created a recurring commitment before confirmation.",
    );
  }

  const uniqueItems = previewRead.body.items.filter(
    (item) => item.valid === true && item.preview?.name === reservedPrefix,
  );
  const selectable = uniqueItems.find((item) => item.duplicateKind === "NONE");
  if (
    uniqueItems.length !== 2 ||
    !selectable ||
    !uniqueItems.some((item) => item.duplicateKind === "IN_FILE") ||
    !previewRead.body.items.some(
      (item) => item.valid === true && item.duplicateKind === "EXISTING",
    ) ||
    !previewRead.body.items.some(
      (item) =>
        item.valid === false &&
        Array.isArray(item.errors) &&
        item.errors.length > 0 &&
        item.preview == null,
    )
  ) {
    throw new Error("Deterministic preview/duplicate/error state was invalid.");
  }

  const confirmKey = idempotencyKey("live-confirm");
  const confirm = await expectJson(
    request,
    "POST",
    `/v1/imports/${upload.body.id}/confirm`,
    200,
    "import confirmation",
    {
      headers: {
        "idempotency-key": confirmKey,
        "if-match": previewEtag,
      },
      data: {
        selectedItemIds: [requireUuid(selectable.id, "selected item ID")],
      },
    },
  );
  if (
    confirm.body.importId !== upload.body.id ||
    confirm.body.status !== "CONFIRMED" ||
    confirm.body.selectedItemCount !== 1 ||
    confirm.body.createdCommitmentCount !== 1 ||
    confirm.body.rawProcessedAt !== previewRead.body.rawProcessedAt ||
    !Array.isArray(confirm.body.commitmentIds) ||
    confirm.body.commitmentIds.length !== 1
  ) {
    throw new Error("Import confirmation returned an invalid summary.");
  }
  responseEtag(confirm.response, confirm.body.version);
  const commitmentId = requireUuid(
    confirm.body.commitmentIds[0],
    "imported commitment ID",
  );

  const confirmReplay = await expectJson(
    request,
    "POST",
    `/v1/imports/${upload.body.id}/confirm`,
    200,
    "import confirmation replay",
    {
      headers: {
        "idempotency-key": confirmKey,
        "if-match": previewEtag,
      },
      data: {
        selectedItemIds: [selectable.id],
      },
    },
  );
  if (JSON.stringify(confirmReplay.body) !== JSON.stringify(confirm.body)) {
    throw new Error("Confirmation replay returned a different result.");
  }

  const stale = await bffRequest(
    request,
    "POST",
    `/v1/imports/${upload.body.id}/confirm`,
    {
      headers: {
        "idempotency-key": idempotencyKey("live-stale-confirm"),
        "if-match": previewEtag,
      },
      data: {
        selectedItemIds: [selectable.id],
      },
    },
  );
  if (stale.status() !== 412) {
    throw new Error(`Stale confirmation returned HTTP ${stale.status()}.`);
  }
  const staleProblem = await boundedJson(stale, "stale confirmation");
  assertRedactedProblem(staleProblem, [reservedPrefix]);

  const imported = await expectJson(
    request,
    "GET",
    `/v1/commitments/${commitmentId}`,
    200,
    "imported commitment",
  );
  if (
    imported.body.displayName !== reservedPrefix ||
    imported.body.source !== "CSV" ||
    imported.body.visibility !== "PRIVATE" ||
    imported.body.status !== "ACTIVE" ||
    imported.body.amountMinor !== 32_100
  ) {
    throw new Error(
      "The confirmed commitment did not preserve safe CSV provenance.",
    );
  }

  const formulaCanary = `M6FORMULA${safeAlphabeticToken()}`;
  const malicious = makeCsv([
    {
      ...uniqueRow,
      name: `=${formulaCanary}`,
    },
  ]);
  const maliciousResponse = await bffRequest(request, "POST", "/v1/imports", {
    headers: {
      "idempotency-key": idempotencyKey("formula-rejection"),
    },
    multipart: {
      householdId,
      file: {
        name: "m6-formula.csv",
        mimeType: "text/csv",
        buffer: malicious,
      },
    },
  });
  if (maliciousResponse.status() !== 400) {
    throw new Error(
      `Formula-like CSV returned HTTP ${maliciousResponse.status()}.`,
    );
  }
  const maliciousProblem = await boundedJson(
    maliciousResponse,
    "malicious CSV rejection",
  );
  assertRedactedProblem(maliciousProblem, [formulaCanary, `=${formulaCanary}`]);

  const discardFixture = makeCsv([
    {
      ...uniqueRow,
      name: `${reservedPrefix} Discard`,
    },
  ]);
  const discardUpload = await uploadCsv(
    request,
    householdId,
    discardFixture,
    "m6-discard.csv",
    idempotencyKey("discard-upload"),
  );
  createdJobIds.add(requireUuid(discardUpload.body.id, "discard import ID"));
  const discardEtag = responseEtag(
    discardUpload.response,
    discardUpload.body.version,
  );
  await restartCanonicalApi();
  const persistedPreview = await expectJson(
    request,
    "GET",
    `/v1/imports/${discardUpload.body.id}`,
    200,
    "restart-safe import preview",
  );
  assertPreview(persistedPreview.body, {
    total: 1,
    valid: 1,
    invalid: 0,
    duplicates: 0,
  });
  if (
    persistedPreview.body.id !== discardUpload.body.id ||
    persistedPreview.response.headers()["cache-control"] !== "no-store"
  ) {
    throw new Error(
      "The restart-safe preview returned invalid identity/cache state.",
    );
  }
  const restartedEtag = responseEtag(
    persistedPreview.response,
    persistedPreview.body.version,
  );
  if (restartedEtag !== discardEtag) {
    throw new Error("API restart changed the persisted preview version.");
  }
  const discarded = await bffRequest(
    request,
    "DELETE",
    `/v1/imports/${discardUpload.body.id}`,
    {
      headers: { "if-match": restartedEtag },
    },
  );
  if (discarded.status() !== 204 || (await discarded.body()).byteLength !== 0) {
    throw new Error(
      "Import discard did not return an empty HTTP 204 response.",
    );
  }

  const persistedRaw = await postgres(
    `SELECT COUNT(*) FROM commitment_import_jobs WHERE id IN (${uuidSqlList(
      createdJobIds,
    )}) AND raw_payload IS NOT NULL;`,
  );
  if (persistedRaw !== "0") {
    throw new Error("An import job committed raw CSV bytes.");
  }
  const restartAuditState = await postgres(
    `SELECT
       (SELECT COUNT(*) FROM audit_events
         WHERE resource_type = 'IMPORT_JOB'
           AND resource_id = '${discardUpload.body.id}'::uuid
           AND action = 'IMPORT_PREVIEW_CREATED') || '|' ||
       (SELECT COUNT(*) FROM audit_events
         WHERE resource_type = 'IMPORT_JOB'
           AND resource_id = '${discardUpload.body.id}'::uuid
           AND action = 'IMPORT_DISCARDED');`,
  );
  if (restartAuditState !== "1|1") {
    throw new Error(
      "Restart-safe preview/discard did not preserve exactly-once audit evidence.",
    );
  }

  const commitmentsAfter = await listCommitments(request, householdId);
  const matching = commitmentsAfter.filter(
    (commitment) => commitment.displayName === reservedPrefix,
  );
  if (
    matching.length !== 1 ||
    matching[0].id !== commitmentId ||
    commitmentsAfter.some(
      (commitment) => commitment.displayName === `${reservedPrefix} Discard`,
    )
  ) {
    throw new Error(
      "Confirmed/unselected/discarded commitment state was invalid.",
    );
  }
} catch (error) {
  primaryFailure = error;
} finally {
  const cleanupFailures = [];
  if (ownerUserId) {
    try {
      await cleanupReservedM6State({
        ownerUserId,
        runStartedAt,
        jobIds: createdJobIds,
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  await session?.context.close().catch((error) => cleanupFailures.push(error));
  await browser?.close().catch((error) => cleanupFailures.push(error));

  if (ownerUserId) {
    try {
      const residue = await postgres(
        `SELECT
           (SELECT COUNT(*) FROM commitment_import_jobs
            WHERE owner_user_id = '${ownerUserId}'::uuid
              AND created_at >= '${runStartedAt}'::timestamptz) || '|' ||
           (SELECT COUNT(*) FROM recurring_commitments
            WHERE data_owner_user_id = '${ownerUserId}'::uuid
              AND display_name LIKE 'M6 Live Fixture %') || '|' ||
           (SELECT COUNT(*) FROM recurring_commitments
            WHERE data_owner_user_id = '${ownerUserId}'::uuid
              AND status = 'ACTIVE') || '|' ||
           (SELECT COUNT(*) FROM recurring_commitments
            WHERE data_owner_user_id = '${ownerUserId}'::uuid
              AND source = 'CSV');`,
      );
      if (residue !== "0|0|4|0") {
        throw new Error("Milestone 6 live fixture residue survived cleanup.");
      }
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  if (primaryFailure || cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures].filter(Boolean),
      "Milestone 6 guarded live acceptance failed.",
    );
  }
}

console.log(
  "Milestone 6 guarded live acceptance passed for preview-only upload with zero committed raw payload, deterministic row errors and duplicates, stable replay, atomic private CSV confirmation, stale-version preservation, formula rejection, API restart-safe normalized preview persistence, exactly-once discard, and deterministic cleanup.",
);

async function uploadCsv(
  request,
  householdId,
  bytes,
  fileName,
  key,
) {
  const response = await bffRequest(request, "POST", "/v1/imports", {
    headers: {
      "idempotency-key": key,
    },
    multipart: {
      householdId,
      file: {
        name: fileName,
        mimeType: "text/csv",
        buffer: bytes,
      },
    },
  });
  if (response.status() !== 201) {
    const problem = await boundedJson(response, "CSV upload failure");
    throw new Error(
      `CSV upload returned HTTP ${response.status()}: ${problem.title ?? "rejected"}.`,
    );
  }
  const body = await boundedJson(response, "CSV upload");
  return { response, body, fileName };
}

async function expectJson(
  request,
  method,
  path,
  expectedStatus,
  label,
  options,
) {
  const response = await bffRequest(request, method, path, options);
  if (response.status() !== expectedStatus) {
    const body = await boundedJson(response, `${label} failure`);
    throw new Error(
      `${label} returned HTTP ${response.status()}: ${body.title ?? "rejected"}.`,
    );
  }
  return {
    response,
    body: await boundedJson(response, label),
  };
}

async function listCommitments(request, householdId) {
  const result = await expectJson(
    request,
    "GET",
    `/v1/commitments?householdId=${householdId}&limit=100&includeArchived=false`,
    200,
    "commitment list",
  );
  return arrayItems(result.body);
}

function arrayItems(value) {
  if (!value || !Array.isArray(value.items)) {
    throw new Error("A paged API response did not contain an items array.");
  }
  return value.items;
}

function assertCanonicalCommitments(commitments) {
  const names = new Set(
    commitments
      .filter((commitment) => commitment.status === "ACTIVE")
      .map((commitment) => commitment.displayName),
  );
  for (const name of [
    "M2 Fixture Monsoon Utility Demo",
    "M2 Fixture FitClub Demo",
    "M2 Fixture CloudNest Demo",
    "M2 Fixture StreamBox Demo",
  ]) {
    if (!names.has(name)) {
      throw new Error(`The canonical commitment '${name}' is missing.`);
    }
  }
}

function assertUploadSummary(body, expected) {
  if (
    body.status !== "PREVIEW_READY" ||
    body.totalItemCount !== expected.total ||
    body.validItemCount !== expected.valid ||
    body.invalidItemCount !== expected.invalid ||
    body.duplicateItemCount !== expected.duplicates ||
    body.rawByteCount < 1 ||
    body.rawByteCount > 256 * 1024
  ) {
    const boundedSummary = {
      status: body.status,
      totalItemCount: body.totalItemCount,
      validItemCount: body.validItemCount,
      invalidItemCount: body.invalidItemCount,
      duplicateItemCount: body.duplicateItemCount,
      rawByteCount: body.rawByteCount,
    };
    throw new Error(
      `The CSV upload returned invalid bounded summary state: ${JSON.stringify(boundedSummary)}.`,
    );
  }
  for (const forbidden of [
    "items",
    "selectedItemCount",
    "createdCommitmentCount",
    "rawProcessedAt",
    "rawPayload",
    "rawSha256",
    "contentFingerprint",
    "fileName",
    "multipart",
  ]) {
    if (Object.hasOwn(body, forbidden)) {
      throw new Error(
        `The upload summary exposed forbidden field '${forbidden}'.`,
      );
    }
  }
}

function assertPreview(body, expected) {
  if (
    body.status !== "PREVIEW_READY" ||
    body.totalItemCount !== expected.total ||
    body.validItemCount !== expected.valid ||
    body.invalidItemCount !== expected.invalid ||
    body.duplicateItemCount !== expected.duplicates ||
    body.selectedItemCount !== 0 ||
    body.createdCommitmentCount !== 0 ||
    !Array.isArray(body.items) ||
    body.items.length !== expected.total ||
    body.rawByteCount < 1 ||
    body.rawByteCount > 256 * 1024 ||
    body.rawProcessedAt == null
  ) {
    throw new Error("The CSV preview returned invalid bounded state.");
  }
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "rawPayload",
    "rawSha256",
    "contentFingerprint",
    "fileName",
    "multipart",
  ]) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new Error(`The preview exposed forbidden field '${forbidden}'.`);
    }
  }
}

function minorToRupees(minor) {
  if (!Number.isSafeInteger(minor) || minor < 1) {
    throw new Error("A canonical amount is not a positive safe integer.");
  }
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

function assertRedactedProblem(problem, canaries) {
  const text = JSON.stringify(problem);
  for (const canary of canaries) {
    if (text.includes(canary)) {
      throw new Error("A problem response echoed rejected CSV content.");
    }
  }
}

function uuidSqlList(values) {
  const ids = Array.from(values, (value) => requireUuid(value, "cleanup ID"));
  if (ids.length < 1 || ids.length > 20) {
    throw new Error("Cleanup requires 1 through 20 exact job IDs.");
  }
  return ids.map((value) => `'${value}'::uuid`).join(", ");
}

async function cleanupReservedM6State({
  ownerUserId: rawOwnerUserId,
  runStartedAt: rawRunStartedAt,
  jobIds,
}) {
  const safeOwnerUserId = requireUuid(rawOwnerUserId, "cleanup owner ID");
  if (
    typeof rawRunStartedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rawRunStartedAt)
  ) {
    throw new Error("The cleanup start timestamp is invalid.");
  }
  const explicitJobs = jobIds.size === 0 ? "NULL::uuid" : uuidSqlList(jobIds);
  const actorKey = operationActorKey();
  const remaining = await postgres(
    `
      BEGIN;

      CREATE TEMP TABLE m6_cleanup_jobs ON COMMIT DROP AS
      SELECT DISTINCT j.id
      FROM commitment_import_jobs j
      LEFT JOIN commitment_import_items i ON i.import_job_id = j.id
      WHERE j.owner_user_id = '${safeOwnerUserId}'::uuid
        AND j.created_at >= '${rawRunStartedAt}'::timestamptz
        AND (
          j.id IN (${explicitJobs})
          OR i.name LIKE 'M6 Live Fixture %'
        );

      CREATE TEMP TABLE m6_cleanup_commitments ON COMMIT DROP AS
      SELECT DISTINCT i.created_commitment_id AS id
      FROM commitment_import_items i
      JOIN m6_cleanup_jobs j ON j.id = i.import_job_id
      WHERE i.created_commitment_id IS NOT NULL;

      DELETE FROM audit_event_locks
      WHERE id IN (
        SELECT id
        FROM audit_events
        WHERE resource_type = 'IMPORT_JOB'
          AND resource_id IN (SELECT id FROM m6_cleanup_jobs)
      );

      DELETE FROM audit_events
      WHERE resource_type = 'IMPORT_JOB'
        AND resource_id IN (SELECT id FROM m6_cleanup_jobs);

      DELETE FROM m5_idempotency_records
      WHERE actor_user_id = '${safeOwnerUserId}'::uuid
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')
        AND (
          resource_id IN (SELECT id FROM m6_cleanup_jobs)
          OR created_at >= '${rawRunStartedAt}'::timestamptz
        );

      DELETE FROM operation_rate_events
      WHERE actor_key = '${actorKey}'
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')
        AND occurred_at >= '${rawRunStartedAt}'::timestamptz;

      DELETE FROM operation_rate_locks
      WHERE actor_key = '${actorKey}'
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');

      UPDATE commitment_import_items
      SET selected = NULL,
          created_commitment_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE import_job_id IN (SELECT id FROM m6_cleanup_jobs);

      DELETE FROM recurring_commitments
      WHERE id IN (SELECT id FROM m6_cleanup_commitments)
        AND data_owner_user_id = '${safeOwnerUserId}'::uuid
        AND source = 'CSV'
        AND display_name LIKE 'M6 Live Fixture %';

      DELETE FROM commitment_import_jobs
      WHERE id IN (SELECT id FROM m6_cleanup_jobs)
        AND owner_user_id = '${safeOwnerUserId}'::uuid;

      SELECT
        (SELECT COUNT(*) FROM commitment_import_jobs
         WHERE id IN (SELECT id FROM m6_cleanup_jobs)) || '|' ||
        (SELECT COUNT(*) FROM recurring_commitments
         WHERE id IN (SELECT id FROM m6_cleanup_commitments)
           AND display_name LIKE 'M6 Live Fixture %');

      COMMIT;
    `,
  );
  if (remaining !== "0|0") {
    throw new Error("Milestone 6 cleanup did not remove its exact fixtures.");
  }
}
