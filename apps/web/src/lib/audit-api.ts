import type {
  AdminAuditEvent,
  AdminAuditEventCollection,
} from "@autopay-guard/contracts";

export type AuditEvent = AdminAuditEvent;
export type AuditPage = AdminAuditEventCollection;

export class AuditApi {
  constructor(
    private readonly baseUrl = "/api/bff",
    private readonly fetchApi = globalThis.fetch.bind(globalThis),
  ) {}

  async list(cursor?: string, signal?: AbortSignal): Promise<AuditPage> {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) {
      query.set("cursor", cursor);
    }
    const response = await this.fetchApi(
      `${this.baseUrl}/v1/admin/audit-events?${query.toString()}`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          accept: "application/json, application/problem+json",
        },
        signal,
      },
    );
    if (!response.ok) {
      let message = "The local audit view could not be loaded.";
      try {
        const problem = (await response.json()) as { detail?: unknown };
        if (typeof problem.detail === "string") {
          message = problem.detail;
        }
      } catch {
        // Keep a non-sensitive fallback.
      }
      throw new Error(message);
    }
    return (await response.json()) as AuditPage;
  }
}
