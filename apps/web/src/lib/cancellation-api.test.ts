import { describe, expect, it, vi } from "vitest";

import { CancellationApi } from "@/lib/cancellation-api";

const occurrenceId = "00000000-0000-4000-8000-000000000041";
const commitmentId = "00000000-0000-4000-8000-000000000042";
const decisionId = "00000000-0000-4000-8000-000000000043";
const guideId = "00000000-0000-4000-8000-000000000044";
const attemptId = "00000000-0000-4000-8000-000000000045";
const householdId = "00000000-0000-4000-8000-000000000046";
const idempotencyKey = "test-key-00000001";

describe("CancellationApi", () => {
  it("encodes only the supported decision-inbox query", async () => {
    const fetchApi = vi.fn().mockResolvedValue(
      jsonResponse({
        householdId,
        from: "2026-07-01",
        to: "2026-07-31",
        items: [],
        nextCursor: null,
      }),
    );
    const api = new CancellationApi({
      baseUrl: "/api/bff/",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.listDecisionInbox({
      householdId,
      from: "2026-07-01",
      to: "2026-07-31",
      cursor: "page_2-safe",
      limit: 25,
    });

    const requestUrl = new URL(
      String(fetchApi.mock.calls[0]?.[0]),
      "https://autopay-guard.test",
    );
    expect(requestUrl.pathname).toBe("/api/bff/v1/decisions/inbox");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      householdId,
      from: "2026-07-01",
      to: "2026-07-31",
      cursor: "page_2-safe",
      limit: "25",
    });
    expect(requestUrl.searchParams.has("action")).toBe(false);
  });

  it("appends a decision with an idempotency key and no privileged fields", async () => {
    const fetchApi = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = new CancellationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.createDecision(
      occurrenceId,
      idempotencyKey,
      "CANCEL_WITH_PROVIDER",
    );

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe(`/api/bff/v1/occurrences/${occurrenceId}/decisions`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      idempotencyKey,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      decision: "CANCEL_WITH_PROVIDER",
    });
    expect(String(init?.body)).not.toMatch(
      /householdId|commitmentId|createdAt|version/,
    );
  });

  it("starts an attempt from the pinned identifiers and nothing else", async () => {
    const fetchApi = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = new CancellationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });
    const body = {
      occurrenceId,
      decisionId,
      guideId,
      guideVersion: 3,
      note: "Called the fictional provider.",
    };

    await api.createAttempt(commitmentId, idempotencyKey, body);

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/bff/v1/commitments/${commitmentId}/cancellation-attempts`,
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      idempotencyKey,
    );
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(String(init?.body)).not.toMatch(
      /householdId|projectedSavings|verificationStatus|serviceStatus/,
    );
  });

  it("uses If-Match and a full track PATCH without an idempotency key", async () => {
    const fetchApi = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = new CancellationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });
    const body = {
      serviceStatus: "CONFIRMED" as const,
      paymentMandateStatus: "REQUESTED" as const,
      abandoned: false,
    };

    await api.updateAttempt(attemptId, '"7"', body);

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe(`/api/bff/v1/cancellation-attempts/${attemptId}`);
    expect(init?.method).toBe("PATCH");
    expect(headers.get("if-match")).toBe('"7"');
    expect(headers.has("idempotency-key")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("requires both replay protection and a version for verification", async () => {
    const fetchApi = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = new CancellationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.verifyAttempt(attemptId, '"8"', idempotencyKey, "VERIFIED");

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe(`/api/bff/v1/cancellation-attempts/${attemptId}/verify`);
    expect(init?.method).toBe("POST");
    expect(headers.get("if-match")).toBe('"8"');
    expect(headers.get("idempotency-key")).toBe(idempotencyKey);
    expect(JSON.parse(String(init?.body))).toEqual({ status: "VERIFIED" });
  });

  it("submits guide feedback with the pinned guide version", async () => {
    const fetchApi = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = new CancellationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });
    const body = {
      commitmentId,
      guideVersion: 3,
      outcome: "UNSAFE_LINK" as const,
      note: null,
    };

    await api.submitFeedback(guideId, idempotencyKey, body);

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe(`/api/bff/v1/cancellation-guides/${guideId}/feedback`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      idempotencyKey,
    );
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
