import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { normalizeBffRequestBody } from "@/lib/bff-body-policy";
import {
  isSubjectExportPath,
  MAX_SUBJECT_EXPORT_BYTES,
  validatedSubjectExportFilename,
} from "@/lib/bff-export-response";
import { normalizeImportUpload } from "@/lib/bff-import-upload";
import {
  isJsonMediaType,
  readBoundedRequestBody,
  requestBodyHasBytes,
} from "@/lib/bff-request";
import {
  type BodyRequirement,
  isSafeEntityTag,
  isSafeIdempotencyKey,
  resolveBffBodyPolicy,
  resolveBffHeaderPolicy,
  resolveBffRoute,
} from "@/lib/bff-routes";
import { createBffProxyResponse } from "@/lib/bff-response";
import { resolveCorrelationId } from "@/lib/correlation-id";
import { getServerEnvironment } from "@/lib/env";
import { fetchWithoutRedirects } from "@/lib/outbound-fetch";
import { isExpectedRequestOrigin } from "@/lib/origin";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_UPSTREAM_BODY_BYTES = 1024 * 1024;
const BODY_PROBE_TIMEOUT_MS = 1_000;
const REQUEST_BODY_TIMEOUT_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

const authenticatedHandler = auth(async (request) => {
  const route = resolveBffRoute(
    request.method,
    request.nextUrl.pathname,
    request.nextUrl.searchParams,
  );
  if (!route) {
    return problem(404, "Not Found", "This BFF operation is not available.");
  }
  const headerPolicy = resolveBffHeaderPolicy(
    request.method,
    request.nextUrl.pathname,
  );
  if (!headerPolicy) {
    return problem(404, "Not Found", "This BFF operation is not available.");
  }
  const bodyPolicy = resolveBffBodyPolicy(
    request.method,
    request.nextUrl.pathname,
  );
  if (!bodyPolicy) {
    return problem(404, "Not Found", "This BFF operation is not available.");
  }

  if (
    request.auth?.error === "RefreshAccessTokenError" ||
    !request.auth?.user?.id ||
    !request.auth.user.email
  ) {
    return problem(401, "Unauthorized", "Sign in to continue.");
  }

  const environment = getServerEnvironment();
  if (
    request.method !== "GET" &&
    !isExpectedRequestOrigin(
      request.headers.get("origin"),
      environment.AUTH_URL,
    )
  ) {
    return problem(403, "Forbidden", "The request origin was not accepted.");
  }

  const accessToken =
    typeof request.auth.apiAccessToken === "string"
      ? request.auth.apiAccessToken
      : null;

  if (!accessToken) {
    return problem(401, "Unauthorized", "Your session must be refreshed.");
  }

  let body: BodyInit | undefined;
  if (bodyPolicy === "multipart-import") {
    const normalizedUpload = await normalizeImportUpload(request);
    if (!normalizedUpload.accepted) {
      return problem(
        normalizedUpload.status,
        normalizedUpload.status === 415
          ? "Unsupported Media Type"
          : normalizedUpload.status === 413
            ? "Payload Too Large"
            : normalizedUpload.status === 408
              ? "Request Timeout"
              : "Bad Request",
        normalizedUpload.detail,
      );
    }
    body = normalizedUpload.body;
  } else {
    const rawBody = await readBoundedJsonBody(request, bodyPolicy);
    if (rawBody instanceof NextResponse) {
      return rawBody;
    }
    const normalizedBody = normalizeBffRequestBody(
      request.method,
      request.nextUrl.pathname,
      rawBody,
    );
    if (!normalizedBody.accepted) {
      return problem(
        400,
        "Bad Request",
        "The JSON body is not accepted for this operation.",
      );
    }
    body = normalizedBody.body;
  }

  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  const upstreamHeaders = new Headers({
    accept: "application/json, application/problem+json",
    authorization: `Bearer ${accessToken}`,
    "x-correlation-id": correlationId,
  });
  if (bodyPolicy === "required") {
    copyHeader(request.headers, upstreamHeaders, "content-type");
  }
  const entityTag = request.headers.get("if-match");
  if (!isSafeEntityTag(entityTag)) {
    return problem(400, "Bad Request", "The If-Match header is invalid.");
  }
  if (entityTag && headerPolicy.ifMatch === "forbidden") {
    return problem(
      400,
      "Bad Request",
      "If-Match is not accepted for this operation.",
    );
  }
  if (!entityTag && headerPolicy.ifMatch === "required") {
    return problem(
      428,
      "Precondition Required",
      "A current If-Match value is required for this operation.",
    );
  }
  if (entityTag) {
    upstreamHeaders.set("if-match", entityTag);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!isSafeIdempotencyKey(idempotencyKey)) {
    return problem(
      400,
      "Bad Request",
      "The Idempotency-Key header is invalid.",
    );
  }
  if (idempotencyKey && headerPolicy.idempotencyKey === "forbidden") {
    return problem(
      400,
      "Bad Request",
      "Idempotency-Key is not accepted for this operation.",
    );
  }
  if (!idempotencyKey && headerPolicy.idempotencyKey === "required") {
    return problem(
      400,
      "Bad Request",
      "An Idempotency-Key is required for this operation.",
    );
  }
  if (idempotencyKey) {
    upstreamHeaders.set("idempotency-key", idempotencyKey);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstreamUrl = new URL(route.path, environment.API_BASE_URL);
    upstreamUrl.search = route.search;
    const upstream = await fetchWithoutRedirects(upstreamUrl, {
      method: request.method,
      body,
      headers: upstreamHeaders,
      cache: "no-store",
      signal: controller.signal,
    });

    const responseHeaders = new Headers({
      "cache-control": "no-store",
      "x-correlation-id": resolveCorrelationId(
        upstream.headers.get("x-correlation-id"),
        () => correlationId,
      ),
    });
    copyHeader(upstream.headers, responseHeaders, "content-type");
    copyHeader(upstream.headers, responseHeaders, "etag");
    const location = safeRelativeLocation(upstream.headers.get("location"));
    if (location) {
      responseHeaders.set("location", location);
    }

    const subjectExport = isSubjectExportPath(route.path);
    const responseBody = await readBoundedUpstreamBody(
      upstream,
      subjectExport ? MAX_SUBJECT_EXPORT_BYTES : MAX_UPSTREAM_BODY_BYTES,
    );
    if (responseBody === null) {
      return problem(
        502,
        "Bad Gateway",
        "The API returned a response that was too large.",
        correlationId,
      );
    }
    const exportFilename =
      subjectExport && upstream.ok
        ? await validatedSubjectExportFilename(upstream, responseBody)
        : null;
    if (subjectExport && upstream.ok && !exportFilename) {
      return problem(
        502,
        "Bad Gateway",
        "The API returned an invalid export response.",
        correlationId,
      );
    }
    if (subjectExport && upstream.ok) {
      responseHeaders.set(
        "content-disposition",
        `attachment; filename="${exportFilename}"`,
      );
      responseHeaders.set(
        "x-content-sha256",
        upstream.headers.get("x-content-sha256") ?? "",
      );
    }

    return createBffProxyResponse(
      upstream.status,
      responseHeaders,
      responseBody,
    );
  } catch {
    return problem(
      502,
      "Service Unavailable",
      "AutoPay Guard could not reach its API. Please try again.",
      correlationId,
    );
  } finally {
    clearTimeout(timeout);
  }
});

export { authenticatedHandler as GET, authenticatedHandler as POST };
export { authenticatedHandler as PUT, authenticatedHandler as PATCH };
export { authenticatedHandler as DELETE };

async function readBoundedJsonBody(
  request: NextRequest,
  bodyPolicy: Exclude<BodyRequirement, "multipart-import">,
): Promise<string | undefined | NextResponse> {
  if (bodyPolicy === "forbidden") {
    if (request.headers.has("content-type")) {
      return problem(
        400,
        "Bad Request",
        "Content-Type is not accepted when this operation has no body.",
      );
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (
      (Number.isFinite(declaredLength) && declaredLength > 0) ||
      (await requestBodyHasBytes(request.body, {
        signal: request.signal,
        timeoutMs: BODY_PROBE_TIMEOUT_MS,
      }))
    ) {
      return problem(
        400,
        "Bad Request",
        "A request body is not accepted for this operation.",
      );
    }
    return undefined;
  }

  const contentType = request.headers.get("content-type");
  if (!isJsonMediaType(contentType)) {
    return problem(
      415,
      "Unsupported Media Type",
      "This endpoint accepts JSON only.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return problem(413, "Payload Too Large", "The request body is too large.");
  }

  if (!request.body) {
    return problem(400, "Bad Request", "A JSON body is required.");
  }

  const boundedBody = await readBoundedRequestBody(request.body, {
    maximumBytes: MAX_JSON_BODY_BYTES,
    signal: request.signal,
    timeoutMs: REQUEST_BODY_TIMEOUT_MS,
  });
  if (boundedBody.kind === "interrupted") {
    return problem(
      408,
      "Request Timeout",
      "The request body was not received in time.",
    );
  }
  if (boundedBody.kind === "too-large") {
    return problem(413, "Payload Too Large", "The request body is too large.");
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      boundedBody.bytes,
    );
    return decoded.length === 0
      ? problem(400, "Bad Request", "A JSON body is required.")
      : decoded;
  } catch {
    return problem(400, "Bad Request", "The JSON body is not valid UTF-8.");
  }
}

async function readBoundedUpstreamBody(
  upstream: Response,
  maximumBytes: number,
) {
  const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await upstream.body?.cancel();
    return null;
  }
  if (!upstream.body) {
    return new Uint8Array();
  }

  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function copyHeader(source: Headers, destination: Headers, name: string) {
  const value = source.get(name);
  if (value) {
    destination.set(name, value);
  }
}

function safeRelativeLocation(value: string | null) {
  if (
    value &&
    /^\/v1\/(?:commitments|imports)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return `/api/bff${value}`;
  }
  return null;
}

function problem(
  status: number,
  title: string,
  detail: string,
  correlationId = crypto.randomUUID(),
) {
  return NextResponse.json(
    {
      type: "about:blank",
      title,
      status,
      detail,
      correlationId,
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
        "x-correlation-id": correlationId,
      },
    },
  );
}
