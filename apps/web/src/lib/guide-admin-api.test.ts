import { describe, expect, it, vi } from "vitest";

import { GuideAdminApi } from "@/lib/guide-admin-api";

describe("GuideAdminApi", () => {
  it("requests the next bounded guide-version page", async () => {
    const guideId = crypto.randomUUID();
    const cursor = crypto.randomUUID();
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ items: [], nextCursor: null }));

    await new GuideAdminApi("/api/bff", fetchApi).versions(
      guideId,
      undefined,
      cursor,
    );

    expect(String(fetchApi.mock.calls[0]?.[0])).toBe(
      `/api/bff/v1/admin/cancellation-guides/${guideId}/versions?cursor=${cursor}&limit=25`,
    );
  });

  it("sends only editable draft fields with the current ETag", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        draftId: crypto.randomUUID(),
        guideId: crypto.randomUUID(),
        guideVersion: 2,
        status: "DRAFT",
        riskNotice: "Safe local demo guidance.",
        structuralReviewedAt: "2026-07-27T00:00:00Z",
        reviewIntervalDays: 45,
        steps: [],
        version: 4,
        createdAt: "2026-07-27T00:00:00Z",
        updatedAt: "2026-07-27T00:00:00Z",
      }),
    );
    const draftId = crypto.randomUUID();
    const body = {
      riskNotice: "Safe local demo guidance.",
      reviewIntervalDays: 45,
      steps: [
        {
          track: "SERVICE" as const,
          sequenceNumber: 1 as const,
          title: "Review",
          instruction: "Review the fictional local service settings.",
        },
      ],
    };

    await new GuideAdminApi("/api/bff", fetchApi).updateDraft(draftId, 3, body);

    const init = fetchApi.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
    expect(new Headers(init?.headers).has("idempotency-key")).toBe(false);
  });

  it("publishes with ETag and idempotency but no editable payload", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        guideId: crypto.randomUUID(),
        publishedVersion: 2,
        catalogState: "ACTIVE",
        catalogVersion: 2,
        publishedAt: "2026-07-27T00:00:00Z",
      }),
    );
    const draftId = crypto.randomUUID();

    await new GuideAdminApi("/api/bff", fetchApi).publishDraft(
      draftId,
      4,
      "guide-publish-0001",
    );

    const init = fetchApi.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(new Headers(init?.headers).get("if-match")).toBe('"4"');
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "guide-publish-0001",
    );
  });
});
