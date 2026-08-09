import type {
  AdminCancellationGuideCollection,
  AdminCancellationGuideDraft,
  AdminCancellationGuideDraftStep,
  AdminCancellationGuideFeedback,
  AdminCancellationGuideFeedbackCollection,
  AdminCancellationGuidePublication,
  AdminCancellationGuideSummary,
  AdminCancellationGuideVersion,
  AdminCancellationGuideVersionCollection,
  ReviewAdminCancellationGuideFeedbackRequest,
  UpdateAdminCancellationGuideDraftRequest,
} from "@autopay-guard/contracts";

export type AdminGuideSummary = AdminCancellationGuideSummary;
export type AdminGuideVersion = AdminCancellationGuideVersion;
export type AdminGuideDraftStep = AdminCancellationGuideDraftStep;
export type AdminGuideDraft = AdminCancellationGuideDraft;
export type UpdateAdminGuideDraft = UpdateAdminCancellationGuideDraftRequest;
export type AdminGuidePublication = AdminCancellationGuidePublication;
export type AdminGuideFeedback = AdminCancellationGuideFeedback;
export type AdminGuideFeedbackPage = AdminCancellationGuideFeedbackCollection;
export type AdminGuideVersionPage = AdminCancellationGuideVersionCollection;

export class GuideAdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GuideAdminApiError";
  }
}

export class GuideAdminApi {
  constructor(
    private readonly baseUrl = "/api/bff",
    private readonly fetchApi = globalThis.fetch.bind(globalThis),
  ) {}

  async listGuides(signal?: AbortSignal) {
    return (
      await this.request<AdminCancellationGuideCollection>(
        "/v1/admin/cancellation-guides",
        { signal },
      )
    ).items;
  }

  getGuide(guideId: string, signal?: AbortSignal) {
    return this.request<AdminGuideSummary>(
      `/v1/admin/cancellation-guides/${encodeURIComponent(guideId)}`,
      { signal },
    );
  }

  versions(guideId: string, signal?: AbortSignal, cursor?: string) {
    const query = new URLSearchParams();
    if (cursor) {
      query.set("cursor", cursor);
      query.set("limit", "25");
    }
    return this.request<AdminGuideVersionPage>(
      `/v1/admin/cancellation-guides/${encodeURIComponent(guideId)}/versions${query.size === 0 ? "" : `?${query.toString()}`}`,
      { signal },
    );
  }

  createDraft(guideId: string, idempotencyKey: string) {
    return this.request<AdminGuideDraft>(
      `/v1/admin/cancellation-guides/${encodeURIComponent(guideId)}/drafts`,
      mutation({
        idempotencyKey,
      }),
    );
  }

  getDraft(draftId: string, signal?: AbortSignal) {
    return this.request<AdminGuideDraft>(
      `/v1/admin/cancellation-guide-drafts/${encodeURIComponent(draftId)}`,
      { signal },
    );
  }

  updateDraft(draftId: string, version: number, body: UpdateAdminGuideDraft) {
    return this.request<AdminGuideDraft>(
      `/v1/admin/cancellation-guide-drafts/${encodeURIComponent(draftId)}`,
      mutation({ method: "PATCH", ifMatch: version, body }),
    );
  }

  publishDraft(draftId: string, version: number, idempotencyKey: string) {
    return this.request<AdminGuidePublication>(
      `/v1/admin/cancellation-guide-drafts/${encodeURIComponent(draftId)}/publish`,
      mutation({ ifMatch: version, idempotencyKey }),
    );
  }

  retireGuide(guideId: string, version: number, idempotencyKey: string) {
    return this.request<AdminGuideSummary>(
      `/v1/admin/cancellation-guides/${encodeURIComponent(guideId)}/retire`,
      mutation({ ifMatch: version, idempotencyKey }),
    );
  }

  feedback(cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) {
      query.set("cursor", cursor);
    }
    return this.request<AdminGuideFeedbackPage>(
      `/v1/admin/cancellation-guide-feedback?${query.toString()}`,
      { signal },
    );
  }

  reviewFeedback(
    feedbackId: string,
    version: number,
    disposition: ReviewAdminCancellationGuideFeedbackRequest["disposition"],
    idempotencyKey: string,
  ) {
    return this.request<AdminGuideFeedback>(
      `/v1/admin/cancellation-guide-feedback/${encodeURIComponent(feedbackId)}/review`,
      mutation({
        ifMatch: version,
        idempotencyKey,
        body: { disposition },
      }),
    );
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
    return (await response.json()) as T;
  }
}

function mutation({
  method = "POST",
  ifMatch,
  idempotencyKey,
  body,
}: {
  method?: "POST" | "PATCH";
  ifMatch?: number;
  idempotencyKey?: string;
  body?: unknown;
}): RequestInit {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (ifMatch !== undefined) {
    headers["if-match"] = `"${ifMatch}"`;
  }
  if (idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey;
  }
  return {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
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
    // Keep the status-only fallback.
  }
  return new GuideAdminApiError(response.status, message);
}
