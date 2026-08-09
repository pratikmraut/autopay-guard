import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { AuditApi, type AuditEvent } from "@/lib/audit-api";

describe("AuditApi", () => {
  it("uses the generated success-only outcome and requests a bounded page", async () => {
    expectTypeOf<AuditEvent["outcome"]>().toEqualTypeOf<"SUCCEEDED">();

    const cursor = crypto.randomUUID();
    const fetchApi = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ items: [], nextCursor: null }));

    await new AuditApi("/api/bff", fetchApi).list(cursor);

    expect(String(fetchApi.mock.calls[0]?.[0])).toBe(
      `/api/bff/v1/admin/audit-events?limit=50&cursor=${cursor}`,
    );
  });
});
