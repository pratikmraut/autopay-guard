export const MAX_SUBJECT_EXPORT_BYTES = 5 * 1024 * 1024;

const SUBJECT_EXPORT_V1_TOP_LEVEL_KEYS = [
  "auditEvents",
  "cancellationData",
  "consentEvents",
  "generatedAt",
  "households",
  "memberships",
  "noticeAcknowledgements",
  "notificationData",
  "privacyRequests",
  "schemaVersion",
  "subject",
  "supportGrants",
] as const;
const SUBJECT_EXPORT_V2_TOP_LEVEL_KEYS = [
  "auditEvents",
  "cancellationData",
  "consentEvents",
  "generatedAt",
  "households",
  "importJobs",
  "memberships",
  "noticeAcknowledgements",
  "notificationData",
  "privacyRequests",
  "schemaVersion",
  "subject",
  "supportGrants",
] as const;
const SUBJECT_EXPORTS = {
  "autopay-guard-export-v1": {
    filename: "autopay-guard-export-v1.json",
    keys: SUBJECT_EXPORT_V1_TOP_LEVEL_KEYS,
  },
  "autopay-guard-export-v2": {
    filename: "autopay-guard-export-v2.json",
    keys: SUBJECT_EXPORT_V2_TOP_LEVEL_KEYS,
  },
} as const;

export function isSubjectExportPath(path: string) {
  return /^\/v1\/privacy\/requests\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\/export$/.test(
    path,
  );
}

export async function isValidSubjectExportResponse(
  upstream: Response,
  body: Uint8Array,
) {
  return (await validatedSubjectExportFilename(upstream, body)) !== null;
}

export async function validatedSubjectExportFilename(
  upstream: Response,
  body: Uint8Array,
): Promise<string | null> {
  const contentType = upstream.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const digest = upstream.headers.get("x-content-sha256");
  const declaredLength = upstream.headers.get("content-length");
  const headersAreValid =
    contentType === "application/json" &&
    typeof digest === "string" &&
    /^[a-f0-9]{64}$/.test(digest) &&
    body.byteLength >= 2 &&
    body.byteLength <= MAX_SUBJECT_EXPORT_BYTES &&
    (declaredLength === null ||
      (/^\d+$/.test(declaredLength) &&
        Number(declaredLength) === body.byteLength));
  if (!headersAreValid) {
    return null;
  }
  if ((await sha256Hex(body)) !== digest) {
    return null;
  }

  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (!bytesEqual(new TextEncoder().encode(text), body)) {
      return null;
    }
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isJsonObject(parsed) || Array.isArray(parsed)) {
    return null;
  }

  const schema =
    typeof parsed.schemaVersion === "string"
      ? SUBJECT_EXPORTS[parsed.schemaVersion as keyof typeof SUBJECT_EXPORTS]
      : undefined;
  if (!schema) {
    return null;
  }
  if (
    upstream.headers.get("content-disposition") !==
    `attachment; filename="${schema.filename}"`
  ) {
    return null;
  }
  const actualKeys = Object.keys(parsed).sort();
  if (
    actualKeys.length !== schema.keys.length ||
    actualKeys.some((key, index) => key !== schema.keys[index])
  ) {
    return null;
  }

  try {
    return JSON.stringify(parsed) === text &&
      JSON.stringify(sortJsonKeys(parsed)) === text
      ? schema.filename
      : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(body: Uint8Array) {
  const bytes = Uint8Array.from(body);
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (!isJsonObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonKeys(value[key])]),
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}
