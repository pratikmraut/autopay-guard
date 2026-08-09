import { describe, expect, it, vi } from "vitest";

import { PrivacyApi, PrivacyApiError } from "@/lib/privacy-api";

describe("PrivacyApi", () => {
  it("requests bounded acknowledgement and consent history pages", async () => {
    const cursor = "00000000-0000-4000-8000-000000000099";
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(
        Response.json({
          purpose: "HOUSEHOLD_SHARING",
          currentPurposeVersion: null,
          currentAction: null,
          events: [],
          nextCursor: null,
        }),
      );
    const api = new PrivacyApi("/api/bff", fetchApi);

    await api.acknowledgements(undefined, cursor);
    await api.consents(undefined, cursor);

    expect(fetchApi.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/bff/v1/privacy/notice-acknowledgements?limit=25&cursor=${cursor}`,
      `/api/bff/v1/privacy/consents?limit=25&cursor=${cursor}`,
    ]);
  });

  it("sends exact consent and privacy request payloads with idempotency", async () => {
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: crypto.randomUUID(),
          purpose: "HOUSEHOLD_SHARING",
          purposeVersion: "foundation-v1",
          action: "GRANTED",
          occurredAt: "2026-07-27T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: crypto.randomUUID(),
          requestType: "CORRECTION",
          status: "REQUESTED",
          correctionField: "timezone",
          correctionValue: "Asia/Kolkata",
          version: 0,
          createdAt: "2026-07-27T00:00:00Z",
          updatedAt: "2026-07-27T00:00:00Z",
          completedAt: null,
          export: null,
        }),
      );
    const api = new PrivacyApi("/api/bff", fetchApi);

    await api.recordSharingConsent(
      "foundation-v1",
      "GRANTED",
      "privacy-consent-0001",
    );
    await api.createRequest(
      "CORRECTION",
      "Asia/Kolkata",
      "privacy-request-0001",
    );

    expect(JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body))).toEqual({
      purpose: "HOUSEHOLD_SHARING",
      purposeVersion: "foundation-v1",
      action: "GRANTED",
    });
    expect(new Headers(fetchApi.mock.calls[0]?.[1]?.headers)).toMatchObject(
      expect.objectContaining({}),
    );
    expect(
      new Headers(fetchApi.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
    ).toBe("privacy-consent-0001");
    expect(JSON.parse(String(fetchApi.mock.calls[1]?.[1]?.body))).toEqual({
      requestType: "CORRECTION",
      correctionValue: "Asia/Kolkata",
    });
  });

  it("accepts only bounded canonical JSON export responses", async () => {
    const payload = new TextEncoder().encode(
      '{"schemaVersion":"autopay-guard-export-v1"}',
    );
    const digest = await sha256(payload);
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition":
            'attachment; filename="autopay-guard-export-v1.json"',
          "x-content-sha256": digest,
        },
      }),
    );

    const result = await new PrivacyApi("/api/bff", fetchApi).exportBytes(
      crypto.randomUUID(),
    );

    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
    expect(result.digest).toBe(digest);
    expect(result.filename).toBe("autopay-guard-export-v1.json");
    expect(result.schemaVersion).toBe("autopay-guard-export-v1");
  });

  it("accepts a new v2 export and retains the exact matching filename", async () => {
    const payload = new TextEncoder().encode(
      '{"schemaVersion":"autopay-guard-export-v2"}',
    );
    const digest = await sha256(payload);
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition":
            'attachment; filename="autopay-guard-export-v2.json"',
          "x-content-sha256": digest,
        },
      }),
    );

    const result = await new PrivacyApi("/api/bff", fetchApi).exportBytes(
      crypto.randomUUID(),
    );

    expect(result.filename).toBe("autopay-guard-export-v2.json");
    expect(result.schemaVersion).toBe("autopay-guard-export-v2");
  });

  it("rejects an arbitrary or schema-mismatched export filename", async () => {
    const payload = new TextEncoder().encode(
      '{"schemaVersion":"autopay-guard-export-v2"}',
    );
    const digest = await sha256(payload);
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition":
            'attachment; filename="autopay-guard-export-v1.json"',
          "x-content-sha256": digest,
        },
      }),
    );

    await expect(
      new PrivacyApi("/api/bff", fetchApi).exportBytes(crypto.randomUUID()),
    ).rejects.toMatchObject({
      status: 502,
      message: "The export response used an unexpected download name.",
    });
  });

  it("omits correctionValue from non-correction request variants", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: crypto.randomUUID(),
        requestType: "EXPORT",
        status: "READY",
        correctionField: null,
        correctionValue: null,
        version: 2,
        createdAt: "2026-07-27T00:00:00Z",
        updatedAt: "2026-07-27T00:00:00Z",
        completedAt: "2026-07-27T00:00:00Z",
        export: null,
      }),
    );

    await new PrivacyApi("/api/bff", fetchApi).createRequest(
      "EXPORT",
      null,
      "privacy-export-0001",
    );

    expect(JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body))).toEqual({
      requestType: "EXPORT",
    });
  });

  it("rejects a canonical-looking export with a mismatched digest", async () => {
    const payload = new TextEncoder().encode(
      '{"schemaVersion":"autopay-guard-export-v1"}',
    );
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition":
            'attachment; filename="autopay-guard-export-v1.json"',
          "x-content-sha256": "a".repeat(64),
        },
      }),
    );

    await expect(
      new PrivacyApi("/api/bff", fetchApi).exportBytes(crypto.randomUUID()),
    ).rejects.toMatchObject({
      status: 502,
      message: "The export response failed its integrity check.",
    });
  });

  it("sends conditional privacy transitions without a request body", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: crypto.randomUUID(),
        requestType: "EXPORT",
        status: "CANCELLED",
        correctionField: null,
        correctionValue: null,
        version: 2,
        createdAt: "2026-07-27T00:00:00Z",
        updatedAt: "2026-07-27T00:01:00Z",
        completedAt: "2026-07-27T00:01:00Z",
        export: null,
      }),
    );
    const requestId = crypto.randomUUID();

    await new PrivacyApi("/api/bff", fetchApi).cancelRequest(
      requestId,
      1,
      "privacy-cancel-0001",
    );

    const init = fetchApi.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "privacy-cancel-0001",
    );
  });

  it("rejects alternate export content and schemas", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"schemaVersion":"other"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition":
            'attachment; filename="autopay-guard-export-v1.json"',
          "x-content-sha256": "a".repeat(64),
        },
      }),
    );

    await expect(
      new PrivacyApi("/api/bff", fetchApi).exportBytes(crypto.randomUUID()),
    ).rejects.toBeInstanceOf(PrivacyApiError);
  });
});

async function sha256(payload: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(payload));
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
