import type {
  CreatedSupportCode,
  SupportCode,
  SupportDiagnostics as GeneratedSupportDiagnostics,
} from "@autopay-guard/contracts";

export type SupportGrant = SupportCode;
export type CreatedSupportGrant = CreatedSupportCode;
export type SupportDiagnostics = GeneratedSupportDiagnostics;

export class SupportApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SupportApiError";
  }
}

export class SupportApi {
  constructor(
    private readonly baseUrl = "/api/bff",
    private readonly fetchApi = globalThis.fetch.bind(globalThis),
  ) {}

  createCode(householdId: string, acknowledgeReadOnlyDiagnostics: boolean) {
    return this.request<CreatedSupportGrant>(
      `/v1/households/${encodeURIComponent(householdId)}/support-codes`,
      {
        method: "POST",
        body: JSON.stringify({ acknowledgeReadOnlyDiagnostics }),
        headers: { "content-type": "application/json" },
      },
    );
  }

  revokeCode(householdId: string, grantId: string, version: number) {
    return this.request<void>(
      `/v1/households/${encodeURIComponent(householdId)}/support-codes/${encodeURIComponent(grantId)}`,
      {
        method: "DELETE",
        headers: { "if-match": `"${version}"` },
      },
    );
  }

  resolve(supportCode: string) {
    return this.request<SupportDiagnostics>("/v1/support/diagnostics/resolve", {
      method: "POST",
      body: JSON.stringify({ supportCode }),
      headers: { "content-type": "application/json" },
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
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
      throw await responseError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

async function responseError(response: Response) {
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
    // Keep the bounded status-only fallback.
  }
  return new SupportApiError(response.status, message);
}
