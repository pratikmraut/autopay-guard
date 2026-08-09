import type {
  ConsentCollection,
  ConsentEvent as ContractConsentEvent,
  PrivacyExportMetadata as ContractPrivacyExportMetadata,
  PrivacyNotice as ContractPrivacyNotice,
  PrivacyNoticeAcknowledgement,
  PrivacyNoticeAcknowledgementCollection,
  PrivacyRequest as ContractPrivacyRequest,
  PrivacyRequestCollection,
} from "@autopay-guard/contracts";

import { MAX_SUBJECT_EXPORT_BYTES, sha256Hex } from "@/lib/bff-export-response";

export type PrivacyNotice = ContractPrivacyNotice;
export type NoticeAcknowledgement = PrivacyNoticeAcknowledgement;
export type NoticeAcknowledgementPage = PrivacyNoticeAcknowledgementCollection;
export type ConsentEvent = ContractConsentEvent;
export type ConsentHistory = ConsentCollection;
export type PrivacyRequestType = ContractPrivacyRequest["requestType"];
export type PrivacyRequestStatus = ContractPrivacyRequest["status"];
export type PrivacyExportMetadata = ContractPrivacyExportMetadata;
export type PrivacyRequest = ContractPrivacyRequest;
export type PrivacyRequestPage = PrivacyRequestCollection;

const EXPORT_FILENAMES = {
  "autopay-guard-export-v1": "autopay-guard-export-v1.json",
  "autopay-guard-export-v2": "autopay-guard-export-v2.json",
} as const;

export class PrivacyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PrivacyApiError";
  }
}

export class PrivacyApi {
  constructor(
    private readonly baseUrl = "/api/bff",
    private readonly fetchApi = globalThis.fetch.bind(globalThis),
  ) {}

  currentNotice(signal?: AbortSignal) {
    return this.request<PrivacyNotice>("/v1/privacy/notices/current", {
      signal,
    });
  }

  acknowledgements(signal?: AbortSignal, cursor?: string) {
    return this.request<NoticeAcknowledgementPage>(
      collectionPath("/v1/privacy/notice-acknowledgements", cursor),
      {
        signal,
      },
    );
  }

  acknowledge(
    noticeVersion: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    return this.request<NoticeAcknowledgement>(
      "/v1/privacy/notice-acknowledgements",
      {
        method: "POST",
        body: JSON.stringify({ noticeVersion }),
        headers: mutationHeaders({ idempotencyKey }),
        signal,
      },
    );
  }

  consents(signal?: AbortSignal, cursor?: string) {
    return this.request<ConsentHistory>(
      collectionPath("/v1/privacy/consents", cursor),
      { signal },
    );
  }

  recordSharingConsent(
    purposeVersion: string,
    action: "GRANTED" | "WITHDRAWN",
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    return this.request<ConsentEvent>("/v1/privacy/consents", {
      method: "POST",
      body: JSON.stringify({
        purpose: "HOUSEHOLD_SHARING",
        purposeVersion,
        action,
      }),
      headers: mutationHeaders({ idempotencyKey }),
      signal,
    });
  }

  requests(signal?: AbortSignal, cursor?: string) {
    return this.request<PrivacyRequestPage>(
      collectionPath("/v1/privacy/requests", cursor),
      { signal },
    );
  }

  createRequest(
    requestType: PrivacyRequestType,
    correctionValue: string | null,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    const body =
      requestType === "CORRECTION"
        ? { requestType, correctionValue }
        : { requestType };
    return this.request<PrivacyRequest>("/v1/privacy/requests", {
      method: "POST",
      body: JSON.stringify(body),
      headers: mutationHeaders({ idempotencyKey }),
      signal,
    });
  }

  cancelRequest(
    requestId: string,
    version: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    return this.request<PrivacyRequest>(
      `/v1/privacy/requests/${encodeURIComponent(requestId)}/cancel`,
      {
        method: "POST",
        headers: mutationHeaders({
          idempotencyKey,
          ifMatch: `"${version}"`,
          jsonBody: false,
        }),
        signal,
      },
    );
  }

  adminRequests(signal?: AbortSignal, cursor?: string) {
    return this.request<PrivacyRequestPage>(
      collectionPath("/v1/admin/privacy/requests", cursor),
      { signal },
    );
  }

  executeRequest(
    requestId: string,
    version: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    return this.request<PrivacyRequest>(
      `/v1/admin/privacy/requests/${encodeURIComponent(requestId)}/execute`,
      {
        method: "POST",
        headers: mutationHeaders({
          idempotencyKey,
          ifMatch: `"${version}"`,
          jsonBody: false,
        }),
        signal,
      },
    );
  }

  async exportBytes(requestId: string, signal?: AbortSignal) {
    const response = await this.fetchApi(
      `${this.baseUrl}/v1/privacy/requests/${encodeURIComponent(requestId)}/export`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      },
    );
    if (!response.ok) {
      throw await apiError(response);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    const disposition = response.headers.get("content-disposition");
    const digest = response.headers.get("x-content-sha256");
    if (
      contentType !== "application/json" ||
      !digest ||
      !/^[a-f0-9]{64}$/.test(digest)
    ) {
      throw new PrivacyApiError(
        502,
        "The export response did not match the safe JSON contract.",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 2 || bytes.byteLength > MAX_SUBJECT_EXPORT_BYTES) {
      throw new PrivacyApiError(
        502,
        "The export response exceeded its safe size boundary.",
      );
    }
    if ((await sha256Hex(bytes)) !== digest) {
      throw new PrivacyApiError(
        502,
        "The export response failed its integrity check.",
      );
    }
    let schemaVersion: keyof typeof EXPORT_FILENAMES;
    try {
      const parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as {
        schemaVersion?: unknown;
      };
      if (
        typeof parsed.schemaVersion !== "string" ||
        !(parsed.schemaVersion in EXPORT_FILENAMES)
      ) {
        throw new Error("Unexpected export schema.");
      }
      schemaVersion = parsed.schemaVersion as keyof typeof EXPORT_FILENAMES;
    } catch {
      throw new PrivacyApiError(
        502,
        "The export response used an unexpected schema.",
      );
    }
    const filename = EXPORT_FILENAMES[schemaVersion];
    if (disposition !== `attachment; filename="${filename}"`) {
      throw new PrivacyApiError(
        502,
        "The export response used an unexpected download name.",
      );
    }
    return { bytes, digest, filename, schemaVersion };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchApi(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json, application/problem+json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw await apiError(response);
    }
    return (await response.json()) as T;
  }
}

function collectionPath(path: string, cursor?: string) {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `${path}?${query.toString()}`;
}

function mutationHeaders({
  idempotencyKey,
  ifMatch,
  jsonBody = true,
}: {
  idempotencyKey: string;
  ifMatch?: string;
  jsonBody?: boolean;
}) {
  const headers: Record<string, string> = {
    "idempotency-key": idempotencyKey,
  };
  if (jsonBody) {
    headers["content-type"] = "application/json";
  }
  if (ifMatch) {
    headers["if-match"] = ifMatch;
  }
  return headers;
}

async function apiError(response: Response) {
  let message = `Request failed with status ${response.status}.`;
  try {
    const problem = (await response.json()) as {
      detail?: unknown;
      title?: unknown;
    };
    if (typeof problem.detail === "string") {
      message = problem.detail;
    } else if (typeof problem.title === "string") {
      message = problem.title;
    }
  } catch {
    // A bounded status-only error remains safe to show.
  }
  return new PrivacyApiError(response.status, message);
}
