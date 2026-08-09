import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = resolve(moduleDirectory, "../..");
export const webBaseUrl = "http://localhost:3000";
export const canonicalOwnerSubject = "11111111-1111-4111-8111-111111111111";

const requireFromWeb = createRequire(
  join(repositoryRoot, "apps/web/package.json"),
);

export function loadChromium() {
  try {
    return requireFromWeb("@playwright/test").chromium;
  } catch (error) {
    throw new Error(
      "Playwright is not installed for apps/web. Run make bootstrap first.",
      { cause: error },
    );
  }
}

export function validateM6NodeEnvironment({ load = false } = {}) {
  requireExact(
    "M6_LIVE_ACCEPTANCE_ACK",
    "I_ACKNOWLEDGE_LOCAL_FAKE_M6_ACCEPTANCE",
  );
  requireExact("COMPOSE_PROJECT_NAME", "autopay-guard");
  requireExact("AUTH_URL", webBaseUrl);
  requireExact(
    "AUTH_KEYCLOAK_ISSUER",
    "http://localhost:8081/realms/autopay-guard",
  );
  requireExact("POSTGRES_DB", "autopay_guard");
  requireExact("POSTGRES_USER", "autopay_guard_admin");
  requireExact("APP_DB_USER", "autopay_guard");
  requireExact("KEYCLOAK_FAKE_USER_USERNAME", "demo@autopayguard.local");
  if (load) {
    requireExact(
      "M6_LOAD_ACCEPTANCE_ACK",
      "I_ACKNOWLEDGE_BOUNDED_LOCAL_FAKE_M6_LOAD",
    );
  }
}

export async function signInOwner(browser, returnTo = "/imports") {
  const context = await browser.newContext({
    baseURL: webBaseUrl,
  });
  const page = await context.newPage();
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  const signInActionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === webBaseUrl &&
      new URL(response.url()).pathname === "/signin",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Continue securely" }).click();
  const signInActionResponse = await signInActionResponsePromise;
  try {
    await page.locator("#username").waitFor({
      state: "visible",
      timeout: 30_000,
    });
  } catch (cause) {
    const headers = signInActionResponse.headers();
    throw new Error(
      `The local sign-in action returned HTTP ${signInActionResponse.status()} with ${headers["content-type"] ?? "no content type"}, action redirect ${headers["x-action-redirect"] ? "present" : "absent"}, and location ${headers.location ? "present" : "absent"}.`,
      { cause },
    );
  }
  await page.locator("#username").fill(required("KEYCLOAK_FAKE_USER_USERNAME"));
  await page.locator("#password").fill(required("KEYCLOAK_FAKE_USER_PASSWORD"));
  await page.locator("#kc-login").click();
  await page.waitForURL(
    (url) =>
      url.origin === webBaseUrl &&
      !url.pathname.startsWith("/signin") &&
      !url.pathname.startsWith("/api/auth"),
    { timeout: 30_000 },
  );
  return { context, page };
}

export async function bffRequest(requestContext, method, path, options = {}) {
  if (!path.startsWith("/v1/") || path.includes("\\") || path.includes("%")) {
    throw new Error("A verifier attempted to use an unsafe BFF path.");
  }
  const headers = {
    accept: "application/json, application/problem+json",
    ...options.headers,
  };
  if (!["GET", "HEAD"].includes(method)) {
    headers.origin = webBaseUrl;
  }
  return requestContext.fetch(`${webBaseUrl}/api/bff${path}`, {
    method,
    headers,
    timeout: options.timeout ?? 10_000,
    failOnStatusCode: false,
    data: options.data,
    multipart: options.multipart,
  });
}

export async function boundedJson(response, label, maximumBytes = 1024 * 1024) {
  const body = await response.body();
  if (body.byteLength < 2 || body.byteLength > maximumBytes) {
    throw new Error(`${label} returned an invalid body size.`);
  }
  const contentType = response.headers()["content-type"]?.split(";", 1)[0];
  if (
    contentType !== "application/json" &&
    contentType !== "application/problem+json"
  ) {
    throw new Error(`${label} returned an invalid content type.`);
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error });
  }
}

export function responseEtag(response, expectedVersion) {
  const etag = response.headers().etag;
  if (!/^"(?:0|[1-9]\d{0,18})"$/.test(etag ?? "")) {
    throw new Error("A Milestone 6 response returned an unsafe ETag.");
  }
  if (
    expectedVersion !== undefined &&
    etag !== `"${String(expectedVersion)}"`
  ) {
    throw new Error("A Milestone 6 ETag did not match its response version.");
  }
  return etag;
}

export function requireUuid(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${label} is not a UUIDv4.`);
  }
  return value;
}

export function idempotencyKey(label) {
  const digest = createHash("sha256")
    .update(`autopay-guard/m6-verifier/${label}/${crypto.randomUUID()}`, "utf8")
    .digest("hex");
  return `m6-${digest.slice(0, 60)}`;
}

export function operationActorKey() {
  return createHash("sha256")
    .update(`autopay-guard/operation-rate/v1:${canonicalOwnerSubject}`, "utf8")
    .digest("hex");
}

export function safeAlphabeticToken(length = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) =>
    String.fromCharCode(65 + (value % 26)),
  ).join("");
}

export function csvCell(value) {
  const text = String(value);
  if (/[\r\n\0]/.test(text)) {
    throw new Error("A verifier fixture attempted to include control content.");
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function makeCsv(rows) {
  const header =
    "name,category,amount,currency,frequency,next_due_date,payment_rail,masked_payment_label";
  const body = rows
    .map((row) =>
      [
        row.name,
        row.category,
        row.amount,
        row.currency,
        row.frequency,
        row.nextDueDate,
        row.paymentRail,
        row.maskedPaymentLabel ?? "",
      ]
        .map(csvCell)
        .join(","),
    )
    .join("\n");
  return Buffer.from(`${header}\n${body}\n`, "utf8");
}

export async function postgres(sql, { timeout = 30_000 } = {}) {
  if (typeof sql !== "string" || sql.length < 1 || sql.length > 40_000) {
    throw new Error("A bounded SQL statement is required.");
  }
  const args = [
    "compose",
    "--project-directory",
    repositoryRoot,
    "--env-file",
    join(repositoryRoot, ".env"),
    "--file",
    join(repositoryRoot, "compose.yaml"),
    "exec",
    "-T",
    "postgres",
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--set=ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--username",
    required("APP_DB_USER"),
    "--dbname",
    required("POSTGRES_DB"),
    "--command",
    sql,
  ];
  const result = await execFile("docker", args, {
    cwd: repositoryRoot,
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function restartCanonicalApi() {
  const deadline = Date.now() + 120_000;
  const composePrefix = [
    "compose",
    "--project-directory",
    repositoryRoot,
    "--env-file",
    join(repositoryRoot, ".env"),
    "--file",
    join(repositoryRoot, "compose.yaml"),
  ];
  await execFile(
    "docker",
    [...composePrefix, "restart", "--timeout", "30", "api"],
    {
      cwd: repositoryRoot,
      timeout: Math.min(60_000, Math.max(1, deadline - Date.now())),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );

  while (Date.now() < deadline) {
    const listTimeout = Math.min(10_000, Math.max(1, deadline - Date.now()));
    const listed = await execFile(
      "docker",
      [...composePrefix, "ps", "--quiet", "api"],
      {
        cwd: repositoryRoot,
        timeout: listTimeout,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      },
    );
    const containerId = listed.stdout.trim();
    if (
      Date.now() < deadline &&
      containerId &&
      /^[0-9a-f]{12,64}$/.test(containerId)
    ) {
      const inspectTimeout = Math.min(
        10_000,
        Math.max(1, deadline - Date.now()),
      );
      const inspected = await execFile(
        "docker",
        [
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}",
          containerId,
        ],
        {
          cwd: repositoryRoot,
          timeout: inspectTimeout,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        },
      );
      if (inspected.stdout.trim() === "healthy") {
        return;
      }
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Math.min(2_000, remaining)),
      );
    }
  }
  throw new Error(
    "The canonical API did not become healthy within 120 seconds of restart.",
  );
}

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("At least one latency sample is required.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil((percentileValue / 100) * sorted.length) - 1,
    ),
  );
  return sorted[rank];
}

export async function boundedPool(items, concurrency, worker) {
  if (
    !Array.isArray(items) ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16
  ) {
    throw new Error("The bounded work pool received invalid limits.");
  }
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      consume(),
    ),
  );
  return results;
}

export function boundedIntegerEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Milestone 6 verification.`);
  }
  return value;
}

function requireExact(name, expected) {
  if (required(name) !== expected) {
    throw new Error(`${name} must equal the canonical fake-local value.`);
  }
}
