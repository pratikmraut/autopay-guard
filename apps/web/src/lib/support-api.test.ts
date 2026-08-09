import { describe, expect, it, vi } from "vitest";

import { SupportApi } from "@/lib/support-api";

describe("SupportApi", () => {
  it("creates a one-time code without an idempotency header", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        grant: {
          id: crypto.randomUUID(),
          status: "ACTIVE",
          version: 0,
          expiresAt: "2026-07-27T00:15:00Z",
          createdAt: "2026-07-27T00:00:00Z",
        },
        supportCode: "A".repeat(43),
      }),
    );
    const householdId = crypto.randomUUID();

    await new SupportApi("/api/bff", fetchApi).createCode(householdId, true);

    const request = fetchApi.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).has("idempotency-key")).toBe(false);
    expect(JSON.parse(String(request?.body))).toEqual({
      acknowledgeReadOnlyDiagnostics: true,
    });
  });

  it("sends only the opaque code to staff diagnostics", async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        schemaVersion: "support-diagnostics-v1",
        status: "HEALTHY",
        activeCommitmentCount: 4,
        failedNotificationCount: 0,
        pendingPrivacyRequestCount: 1,
        latestCommitmentVersion: 2,
        generatedAt: "2026-07-27T00:00:00Z",
        grantExpiresAt: "2026-07-27T00:15:00Z",
      }),
    );

    await new SupportApi("/api/bff", fetchApi).resolve("A".repeat(43));

    expect(JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body))).toEqual({
      supportCode: "A".repeat(43),
    });
  });
});
