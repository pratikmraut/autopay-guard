import { readBoundedRequestBody } from "@/lib/bff-request";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MULTIPART_CONTENT_TYPE =
  /^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))$/i;

export const MAX_IMPORT_FILE_BYTES = 256 * 1024;
export const MAX_IMPORT_MULTIPART_BYTES = MAX_IMPORT_FILE_BYTES + 16 * 1024;

export type NormalizedImportUpload =
  | { accepted: true; body: FormData }
  | {
      accepted: false;
      status: 400 | 408 | 413 | 415;
      detail: string;
    };

export async function normalizeImportUpload(
  request: Request,
): Promise<NormalizedImportUpload> {
  if (request.headers.has("content-encoding")) {
    return rejected(
      415,
      "Encoded multipart uploads are not accepted for this operation.",
    );
  }

  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (!MULTIPART_CONTENT_TYPE.test(contentType)) {
    return rejected(415, "This endpoint accepts a multipart CSV upload only.");
  }

  const declaredLength = parseDeclaredLength(
    request.headers.get("content-length"),
  );
  if (declaredLength === "invalid") {
    return rejected(400, "The Content-Length header is invalid.");
  }
  if (
    typeof declaredLength === "number" &&
    declaredLength > MAX_IMPORT_MULTIPART_BYTES
  ) {
    return rejected(413, "The multipart upload is too large.");
  }
  if (!request.body) {
    return rejected(400, "A multipart CSV upload is required.");
  }

  const bounded = await readBoundedRequestBody(request.body, {
    maximumBytes: MAX_IMPORT_MULTIPART_BYTES,
    signal: request.signal,
    timeoutMs: 10_000,
  });
  if (bounded.kind === "interrupted") {
    return rejected(408, "The multipart upload was not received in time.");
  }
  if (bounded.kind === "too-large") {
    return rejected(413, "The multipart upload is too large.");
  }

  let form: FormData;
  try {
    form = await new Request("http://bff.invalid/import", {
      method: "POST",
      headers: { "content-type": contentType },
      body: Uint8Array.from(bounded.bytes).buffer,
    }).formData();
  } catch {
    return rejected(400, "The multipart upload is malformed.");
  }

  const entries = [...form.entries()];
  if (
    entries.length !== 2 ||
    entries.filter(([name]) => name === "householdId").length !== 1 ||
    entries.filter(([name]) => name === "file").length !== 1
  ) {
    return rejected(
      400,
      "The multipart upload must contain exactly householdId and file.",
    );
  }

  const householdId = form.get("householdId");
  const file = form.get("file");
  if (
    typeof householdId !== "string" ||
    householdId !== householdId.trim() ||
    !UUID.test(householdId)
  ) {
    return rejected(400, "The householdId field is invalid.");
  }
  if (!isFile(file)) {
    return rejected(400, "The file field must contain one CSV file.");
  }
  if (
    file.type !== "text/csv" ||
    file.name.length > 255 ||
    /[\u0000-\u001f\u007f/\\]/.test(file.name) ||
    file.name.includes("..") ||
    !file.name.toLowerCase().endsWith(".csv")
  ) {
    return rejected(
      415,
      "The uploaded file must use the .csv extension and text/csv type.",
    );
  }
  if (file.size < 1) {
    return rejected(400, "The uploaded CSV file is empty.");
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return rejected(413, "The uploaded CSV file exceeds 256 KiB.");
  }

  const safeBody = new FormData();
  safeBody.set("householdId", householdId);
  safeBody.set(
    "file",
    new File([await file.arrayBuffer()], "import.csv", {
      type: "text/csv",
    }),
  );
  return { accepted: true, body: safeBody };
}

function isFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value !== "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}

function parseDeclaredLength(value: string | null): number | "invalid" | null {
  if (value === null) {
    return null;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    return "invalid";
  }
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : "invalid";
}

function rejected(
  status: 400 | 408 | 413 | 415,
  detail: string,
): NormalizedImportUpload {
  return { accepted: false, status, detail };
}
