import { performance } from "node:perf_hooks";

import {
  bffRequest,
  boundedIntegerEnvironment,
  boundedJson,
  boundedPool,
  idempotencyKey,
  loadChromium,
  makeCsv,
  operationActorKey,
  percentile,
  postgres,
  requireUuid,
  responseEtag,
  safeAlphabeticToken,
  signInOwner,
  validateM6NodeEnvironment,
} from "./lib/m6-browser.mjs";

validateM6NodeEnvironment({ load: true });

const readCount = boundedIntegerEnvironment("M6_LOAD_READS", 120, 50, 500);
const concurrency = boundedIntegerEnvironment("M6_LOAD_CONCURRENCY", 8, 1, 16);
const writeCycles = boundedIntegerEnvironment("M6_LOAD_WRITE_CYCLES", 3, 3, 5);
const warmupCount = Math.min(10, readCount);
const p95BudgetMilliseconds = 400;
const runStartedAt = new Date().toISOString();
const reservedPrefix = `M6 Load Fixture ${safeAlphabeticToken()}`;
const jobIds = new Set();
const readLatencies = [];
const writeLatencies = [];
let browser;
let session;
let ownerUserId;
let primaryFailure;

try {
  browser = await loadChromium().launch({ headless: true });
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
  const ownedHouseholds = requireItems(households.body).filter(
    (household) =>
      household.canManage === true || household.accessRole === "OWNER",
  );
  if (ownedHouseholds.length !== 1) {
    throw new Error("The canonical owner must manage exactly one household.");
  }
  const household = ownedHouseholds[0];
  const householdId = requireUuid(household.id, "canonical household ID");
  const month = currentMonth(household.timezone);

  await assertCleanBaseline(householdId, ownerUserId);

  const reads = [
    {
      label: "dashboard summary",
      path: `/v1/dashboard/summary?householdId=${householdId}&month=${month}`,
      validate(body) {
        if (
          body.householdId !== householdId ||
          body.month !== month ||
          body.activeCommitmentCount !== 4 ||
          !body.monthlyProjection ||
          !body.annualizedProjection
        ) {
          throw new Error("A dashboard read returned non-canonical state.");
        }
      },
    },
    {
      label: "commitment list",
      path:
        `/v1/commitments?householdId=${householdId}` +
        "&limit=100&includeArchived=false",
      validate(body) {
        assertCanonicalCommitments(requireItems(body));
      },
    },
  ];

  for (let index = 0; index < warmupCount; index += 1) {
    await measuredRead(request, reads[index % reads.length]);
  }

  await boundedPool(
    Array.from(
      { length: readCount },
      (_, index) => reads[index % reads.length],
    ),
    concurrency,
    async (read) => {
      readLatencies.push(await measuredRead(request, read));
    },
  );

  for (let cycle = 0; cycle < writeCycles; cycle += 1) {
    const name = `${reservedPrefix} ${String.fromCharCode(65 + cycle)}`;
    const fixture = makeCsv([
      {
        name,
        category: "SUBSCRIPTION",
        amount: "199.00",
        currency: "INR",
        frequency: "YEARLY",
        nextDueDate: "2099-12-31",
        paymentRail: "CASH_OR_MANUAL",
        maskedPaymentLabel: "Bounded load fixture",
      },
    ]);

    const uploadStart = performance.now();
    const uploaded = await bffRequest(request, "POST", "/v1/imports", {
      headers: {
        "idempotency-key": idempotencyKey(`load-upload-${cycle}`),
      },
      multipart: {
        householdId,
        file: {
          name: `m6-load-${String.fromCharCode(97 + cycle)}.csv`,
          mimeType: "text/csv",
          buffer: fixture,
        },
      },
    });
    if (uploaded.status() !== 201) {
      const problem = await boundedJson(uploaded, "load upload failure");
      throw new Error(
        `Load upload returned HTTP ${uploaded.status()}: ${
          problem.title ?? "rejected"
        }.`,
      );
    }
    const job = await boundedJson(uploaded, "load upload");
    writeLatencies.push(performance.now() - uploadStart);
    const jobId = requireUuid(job.id, "load import job ID");
    jobIds.add(jobId);
    if (
      job.status !== "PREVIEW_READY" ||
      job.totalItemCount !== 1 ||
      job.validItemCount !== 1 ||
      job.invalidItemCount !== 0 ||
      job.duplicateItemCount !== 0 ||
      Object.hasOwn(job, "items") ||
      Object.hasOwn(job, "selectedItemCount") ||
      Object.hasOwn(job, "createdCommitmentCount") ||
      Object.hasOwn(job, "rawProcessedAt")
    ) {
      throw new Error("A bounded load upload returned invalid preview state.");
    }
    const previewRawState = await postgres(
      `SELECT (raw_payload IS NULL) || '|' || (raw_processed_at IS NOT NULL)
         FROM commitment_import_jobs
        WHERE id = '${jobId}'::uuid;`,
    );
    if (previewRawState !== "true|true") {
      throw new Error(
        "A bounded load upload committed raw CSV instead of normalized preview state.",
      );
    }
    const etag = responseEtag(uploaded, job.version);

    const discardStart = performance.now();
    const discarded = await bffRequest(
      request,
      "DELETE",
      `/v1/imports/${jobId}`,
      { headers: { "if-match": etag } },
    );
    const discardBody = await discarded.body();
    writeLatencies.push(performance.now() - discardStart);
    if (discarded.status() !== 204 || discardBody.byteLength !== 0) {
      throw new Error(
        `Load discard returned an invalid HTTP ${discarded.status()} response.`,
      );
    }
  }

  const terminalState = await postgres(
    `SELECT COUNT(*) || '|' ||
            COUNT(*) FILTER (WHERE status = 'DISCARDED') || '|' ||
            COUNT(*) FILTER (WHERE raw_payload IS NULL)
       FROM commitment_import_jobs
      WHERE id IN (${uuidSqlList(jobIds)});`,
  );
  if (terminalState !== `${writeCycles}|${writeCycles}|${writeCycles}`) {
    throw new Error("Bounded load jobs did not reach terminal discard state.");
  }

  assertLatencyBudget("read", readLatencies);
  assertLatencyBudget("write", writeLatencies);
} catch (error) {
  primaryFailure = error;
} finally {
  const cleanupFailures = [];
  if (ownerUserId) {
    try {
      await cleanupLoadState(ownerUserId);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  await session?.context.close().catch((error) => cleanupFailures.push(error));
  await browser?.close().catch((error) => cleanupFailures.push(error));

  if (ownerUserId) {
    try {
      await assertNoLoadResidue(ownerUserId);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  if (primaryFailure || cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryFailure, ...cleanupFailures].filter(Boolean),
      "Milestone 6 bounded local load acceptance failed.",
    );
  }
}

console.log(
  [
    "Milestone 6 bounded local load acceptance passed.",
    latencyLine("read", readLatencies),
    latencyLine("write", writeLatencies),
    `Bounds: ${readCount} measured reads, ${writeCycles} upload/discard cycles, concurrency ${concurrency}, fixed P95 hypothesis ${p95BudgetMilliseconds} ms.`,
    "Every upload retained normalized preview state with zero committed raw payload. All reserved import jobs, idempotency/rate/audit rows, and lock rows were removed; no commitment was created.",
  ].join("\n"),
);

async function measuredRead(request, read) {
  const started = performance.now();
  const response = await bffRequest(request, "GET", read.path);
  if (response.status() !== 200) {
    const problem = await boundedJson(response, `${read.label} failure`);
    throw new Error(
      `${read.label} returned HTTP ${response.status()}: ${
        problem.title ?? "rejected"
      }.`,
    );
  }
  const body = await boundedJson(response, read.label);
  read.validate(body);
  return performance.now() - started;
}

async function expectJson(request, method, path, status, label, options) {
  const response = await bffRequest(request, method, path, options);
  if (response.status() !== status) {
    const problem = await boundedJson(response, `${label} failure`);
    throw new Error(
      `${label} returned HTTP ${response.status()}: ${
        problem.title ?? "rejected"
      }.`,
    );
  }
  return {
    response,
    body: await boundedJson(response, label),
  };
}

function currentMonth(timezone) {
  if (
    typeof timezone !== "string" ||
    timezone.length < 3 ||
    timezone.length > 64
  ) {
    throw new Error("The canonical household timezone is invalid.");
  }
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
  } catch (error) {
    throw new Error("The canonical household timezone is unsupported.", {
      cause: error,
    });
  }
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!/^\d{4}$/.test(year ?? "") || !/^\d{2}$/.test(month ?? "")) {
    throw new Error("The household-local month could not be derived.");
  }
  return `${year}-${month}`;
}

function requireItems(value) {
  if (!value || !Array.isArray(value.items)) {
    throw new Error("A paged API response did not contain an items array.");
  }
  return value.items;
}

function assertCanonicalCommitments(commitments) {
  if (
    commitments.filter((commitment) => commitment.status === "ACTIVE")
      .length !== 4
  ) {
    throw new Error("The active commitment count is not canonical.");
  }
  const activeNames = new Set(
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
    if (!activeNames.has(name)) {
      throw new Error(`The canonical commitment '${name}' is missing.`);
    }
  }
}

function assertLatencyBudget(label, values) {
  if (values.length < 1 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} latency samples are invalid.`);
  }
  const p95 = percentile(values, 95);
  if (p95 >= p95BudgetMilliseconds) {
    throw new Error(
      `${label} P95 ${p95.toFixed(1)} ms did not satisfy the local ` +
        `${p95BudgetMilliseconds} ms beta hypothesis.`,
    );
  }
}

function latencyLine(label, values) {
  return `${label}: samples=${values.length}, P50=${percentile(
    values,
    50,
  ).toFixed(1)} ms, P95=${percentile(values, 95).toFixed(
    1,
  )} ms, max=${Math.max(...values).toFixed(1)} ms`;
}

function uuidSqlList(values) {
  const ids = Array.from(values, (value) => requireUuid(value, "cleanup ID"));
  if (ids.length < 1 || ids.length > 5) {
    throw new Error("Load cleanup requires 1 through 5 exact job IDs.");
  }
  return ids.map((value) => `'${value}'::uuid`).join(", ");
}

async function assertCleanBaseline(householdId, rawOwnerUserId) {
  const safeOwnerUserId = requireUuid(rawOwnerUserId, "baseline owner ID");
  const baseline = await postgres(
    `SELECT
       (SELECT COUNT(*) FROM recurring_commitments
         WHERE household_id = '${householdId}'::uuid
           AND status = 'ACTIVE') || '|' ||
       (SELECT COUNT(*) FROM recurring_commitments
         WHERE data_owner_user_id = '${safeOwnerUserId}'::uuid
           AND source = 'CSV') || '|' ||
       (SELECT COUNT(*) FROM commitment_import_jobs
         WHERE owner_user_id = '${safeOwnerUserId}'::uuid);`,
  );
  if (baseline !== "4|0|0") {
    throw new Error(
      "Bounded load requires the clean four-commitment M1-M5 baseline.",
    );
  }
}

async function cleanupLoadState(rawOwnerUserId) {
  const safeOwnerUserId = requireUuid(rawOwnerUserId, "cleanup owner ID");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(runStartedAt)) {
    throw new Error("The load cleanup timestamp is invalid.");
  }
  const explicitJobs = jobIds.size === 0 ? "NULL::uuid" : uuidSqlList(jobIds);
  const actorKey = operationActorKey();
  await postgres(
    `
      BEGIN;

      CREATE TEMP TABLE m6_load_cleanup_jobs ON COMMIT DROP AS
      SELECT DISTINCT j.id
      FROM commitment_import_jobs j
      LEFT JOIN commitment_import_items i ON i.import_job_id = j.id
      WHERE j.owner_user_id = '${safeOwnerUserId}'::uuid
        AND j.created_at >= '${runStartedAt}'::timestamptz
        AND (
          j.id IN (${explicitJobs})
          OR i.name LIKE 'M6 Load Fixture %'
        );

      DELETE FROM audit_event_locks
      WHERE id IN (
        SELECT id FROM audit_events
        WHERE resource_type = 'IMPORT_JOB'
          AND resource_id IN (SELECT id FROM m6_load_cleanup_jobs)
      );

      DELETE FROM audit_events
      WHERE resource_type = 'IMPORT_JOB'
        AND resource_id IN (SELECT id FROM m6_load_cleanup_jobs);

      DELETE FROM m5_idempotency_records
      WHERE actor_user_id = '${safeOwnerUserId}'::uuid
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')
        AND (
          resource_id IN (SELECT id FROM m6_load_cleanup_jobs)
          OR created_at >= '${runStartedAt}'::timestamptz
        );

      DELETE FROM operation_rate_events
      WHERE actor_key = '${actorKey}'
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')
        AND occurred_at >= '${runStartedAt}'::timestamptz;

      DELETE FROM operation_rate_locks
      WHERE actor_key = '${actorKey}'
        AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM');

      DELETE FROM commitment_import_jobs
      WHERE id IN (SELECT id FROM m6_load_cleanup_jobs)
        AND owner_user_id = '${safeOwnerUserId}'::uuid;

      COMMIT;
    `,
  );
}

async function assertNoLoadResidue(rawOwnerUserId) {
  const safeOwnerUserId = requireUuid(rawOwnerUserId, "residue owner ID");
  const actorKey = operationActorKey();
  const residue = await postgres(
    `SELECT
       (SELECT COUNT(*) FROM commitment_import_jobs j
          LEFT JOIN commitment_import_items i ON i.import_job_id = j.id
         WHERE j.owner_user_id = '${safeOwnerUserId}'::uuid
           AND j.created_at >= '${runStartedAt}'::timestamptz
           AND (j.id IN (${
             jobIds.size === 0 ? "NULL::uuid" : uuidSqlList(jobIds)
           }) OR i.name LIKE 'M6 Load Fixture %')) || '|' ||
       (SELECT COUNT(*) FROM recurring_commitments
         WHERE data_owner_user_id = '${safeOwnerUserId}'::uuid
           AND display_name LIKE 'M6 Load Fixture %') || '|' ||
       (SELECT COUNT(*) FROM m5_idempotency_records
         WHERE actor_user_id = '${safeOwnerUserId}'::uuid
           AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')
           AND created_at >= '${runStartedAt}'::timestamptz) || '|' ||
       (SELECT COUNT(*) FROM operation_rate_events
         WHERE actor_key = '${actorKey}'
           AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')
           AND occurred_at >= '${runStartedAt}'::timestamptz) || '|' ||
       (SELECT COUNT(*) FROM operation_rate_locks
         WHERE actor_key = '${actorKey}'
           AND operation IN ('IMPORT_CREATE', 'IMPORT_CONFIRM')) || '|' ||
       (SELECT COUNT(*) FROM recurring_commitments
         WHERE data_owner_user_id = '${safeOwnerUserId}'::uuid
           AND status = 'ACTIVE') || '|' ||
       (SELECT COUNT(*) FROM recurring_commitments
         WHERE data_owner_user_id = '${safeOwnerUserId}'::uuid
           AND source = 'CSV');`,
  );
  if (residue !== "0|0|0|0|0|4|0") {
    throw new Error(`Milestone 6 load residue survived cleanup (${residue}).`);
  }
}
