import { describe, expect, it } from "vitest";

import {
  acceptsEntityTag,
  isSafeEntityTag,
  isSafeIdempotencyKey,
  resolveBffBodyPolicy,
  resolveBffHeaderPolicy,
  resolveBffRoute,
} from "@/lib/bff-routes";

const id = "00000000-0000-4000-8000-000000000123";

describe("authenticated BFF route policy", () => {
  it.each([
    ["POST", "/api/bff/v1/imports"],
    ["GET", `/api/bff/v1/imports/${id}`],
    ["POST", `/api/bff/v1/imports/${id}/confirm`],
    ["DELETE", `/api/bff/v1/imports/${id}`],
  ])("allows an exact import operation: %s %s", (method, path) => {
    expect(resolveBffRoute(method, path, new URLSearchParams())).toEqual({
      path: path.slice("/api/bff".length),
      search: "",
    });
  });

  it("applies exact import body and concurrency policy", () => {
    expect(resolveBffBodyPolicy("POST", "/api/bff/v1/imports")).toBe(
      "multipart-import",
    );
    expect(resolveBffHeaderPolicy("POST", "/api/bff/v1/imports")).toEqual({
      ifMatch: "forbidden",
      idempotencyKey: "required",
    });
    expect(
      resolveBffHeaderPolicy("POST", `/api/bff/v1/imports/${id}/confirm`),
    ).toEqual({ ifMatch: "required", idempotencyKey: "required" });
    expect(
      resolveBffBodyPolicy("POST", `/api/bff/v1/imports/${id}/confirm`),
    ).toBe("required");
    expect(resolveBffBodyPolicy("DELETE", `/api/bff/v1/imports/${id}`)).toBe(
      "forbidden",
    );
  });

  it.each([
    ["PUT", "/api/bff/v1/imports"],
    ["GET", "/api/bff/v1/imports"],
    ["POST", `/api/bff/v1/imports/${id}`],
    ["DELETE", `/api/bff/v1/imports/${id}/confirm`],
    ["GET", `/api/bff/v1/imports/${id}/extra`],
  ])("rejects a non-contract import route: %s %s", (method, path) => {
    expect(resolveBffRoute(method, path, new URLSearchParams())).toBeNull();
  });

  it("allows a UUID-scoped commitment mutation", () => {
    expect(
      resolveBffRoute(
        "PATCH",
        `/api/bff/v1/commitments/${id}`,
        new URLSearchParams(),
      ),
    ).toEqual({ path: `/v1/commitments/${id}`, search: "" });
  });

  it("allows create without a household query because scope is in the body", () => {
    expect(
      resolveBffRoute("POST", "/api/bff/v1/commitments", new URLSearchParams()),
    ).toEqual({ path: "/v1/commitments", search: "" });
  });

  it("normalizes only allowlisted upcoming query parameters", () => {
    expect(
      resolveBffRoute(
        "GET",
        "/api/bff/v1/commitments/upcoming",
        new URLSearchParams({
          to: "2026-09-30",
          householdId: id,
          from: "2026-07-01",
        }),
      ),
    ).toEqual({
      path: "/v1/commitments/upcoming",
      search:
        "from=2026-07-01&householdId=00000000-0000-4000-8000-000000000123&to=2026-09-30",
    });
  });

  it.each([
    ["GET", "/api/bff/v1/commitments/not-a-uuid", ""],
    ["GET", "/api/bff/v1/commitments", "householdId=not-a-uuid"],
    ["GET", "/api/bff/v1/commitments", "limit=1000"],
    ["GET", "/api/bff/v1/merchants/search", "q=%0d%0aattack"],
    ["GET", "/api/bff/v1/commitments/upcoming", `householdId=${id}&limit=50`],
    ["GET", "/api/bff/v1/merchants/search", ""],
    ["GET", "/api/bff/v1/dashboard/summary", "redirect=https://evil.test"],
    ["POST", `/api/bff/v1/commitments/${id}`, ""],
  ])("rejects an unsafe request: %s %s?%s", (method, path, query) => {
    expect(
      resolveBffRoute(method, path, new URLSearchParams(query)),
    ).toBeNull();
  });

  it("validates concurrency headers", () => {
    expect(isSafeEntityTag('"0"')).toBe(true);
    expect(isSafeEntityTag('"7"')).toBe(true);
    expect(isSafeEntityTag('"1234567890123456789"')).toBe(true);
    expect(isSafeEntityTag('"01"')).toBe(false);
    expect(isSafeEntityTag('"-1"')).toBe(false);
    expect(isSafeEntityTag('W/"7"')).toBe(false);
    expect(isSafeEntityTag('"7"\r\nx-evil: yes')).toBe(false);
  });

  it("allows entity tags only on supported mutations, including PUT", () => {
    expect(acceptsEntityTag("PUT")).toBe(true);
    expect(acceptsEntityTag("PATCH")).toBe(true);
    expect(acceptsEntityTag("DELETE")).toBe(true);
    expect(acceptsEntityTag("GET")).toBe(false);
    expect(acceptsEntityTag("POST")).toBe(false);
  });

  it("validates conservative idempotency keys", () => {
    expect(
      isSafeIdempotencyKey("m4-00000000-0000-4000-8000-000000000123"),
    ).toBe(true);
    expect(isSafeIdempotencyKey("short")).toBe(false);
    expect(isSafeIdempotencyKey(`valid-key-123456\r\nx-evil`)).toBe(false);
    expect(isSafeIdempotencyKey("contains spaces 123456")).toBe(false);
  });

  it.each([
    ["GET", "/api/bff/v1/notification-preferences", ""],
    ["PUT", "/api/bff/v1/notification-preferences", ""],
    ["GET", `/api/bff/v1/households/${id}/reminder-rules`, ""],
    ["PUT", `/api/bff/v1/households/${id}/reminder-rules`, ""],
    ["GET", `/api/bff/v1/commitments/${id}/reminder-rules`, ""],
    ["PUT", `/api/bff/v1/commitments/${id}/reminder-rules`, ""],
    [
      "GET",
      "/api/bff/v1/notifications",
      `limit=25&filter=FAILED&householdId=${id}`,
    ],
    ["GET", `/api/bff/v1/notifications/${id}`, ""],
    ["PATCH", `/api/bff/v1/notifications/${id}`, ""],
    ["GET", "/api/bff/v1/notification-diagnostics", `householdId=${id}`],
  ])("allows a Milestone 3 route: %s %s?%s", (method, path, query) => {
    expect(
      resolveBffRoute(method, path, new URLSearchParams(query)),
    ).not.toBeNull();
  });

  it("normalizes the notification-list allowlist only", () => {
    expect(
      resolveBffRoute(
        "GET",
        "/api/bff/v1/notifications",
        new URLSearchParams({
          limit: "25",
          householdId: id,
          filter: "UNREAD",
          cursor: "next_page-2",
        }),
      ),
    ).toEqual({
      path: "/v1/notifications",
      search: `cursor=next_page-2&filter=UNREAD&householdId=${id}&limit=25`,
    });
  });

  it.each([
    ["GET", "/api/bff/v1/notification-preferences", "redirect=evil"],
    ["POST", "/api/bff/v1/notification-preferences", ""],
    ["PATCH", `/api/bff/v1/households/${id}/reminder-rules`, ""],
    ["PUT", `/api/bff/v1/notifications/${id}`, ""],
    ["GET", "/api/bff/v1/notifications", `householdId=${id}&filter=unread`],
    ["GET", "/api/bff/v1/notifications", `householdId=${id}&limit=101`],
    [
      "GET",
      "/api/bff/v1/notifications",
      `householdId=${id}&filter=ALL&filter=FAILED`,
    ],
    ["GET", "/api/bff/v1/notifications", "householdId=not-a-uuid"],
    ["GET", "/api/bff/v1/notification-diagnostics", ""],
    [
      "GET",
      "/api/bff/v1/notification-diagnostics",
      `householdId=${id}&provider=mailpit`,
    ],
    ["POST", `/api/bff/v1/notifications/${id}/retry`, ""],
    ["GET", "/api/bff/v1/admin/notification-diagnostics", ""],
    ["PUT", `/api/bff/v1/households/not-a-uuid/reminder-rules`, ""],
  ])(
    "rejects an unsafe Milestone 3 request: %s %s?%s",
    (method, path, query) => {
      expect(
        resolveBffRoute(method, path, new URLSearchParams(query)),
      ).toBeNull();
    },
  );

  it.each([
    [
      "GET",
      "/api/bff/v1/decisions/inbox",
      `householdId=${id}&from=2026-07-01&to=2026-09-30&limit=25`,
    ],
    ["POST", `/api/bff/v1/occurrences/${id}/decisions`, ""],
    ["GET", `/api/bff/v1/commitments/${id}/cancellation-guide`, ""],
    [
      "GET",
      `/api/bff/v1/commitments/${id}/cancellation-attempts`,
      `householdId=${id}&limit=25`,
    ],
    ["POST", `/api/bff/v1/commitments/${id}/cancellation-attempts`, ""],
    ["GET", `/api/bff/v1/cancellation-attempts/${id}`, ""],
    ["PATCH", `/api/bff/v1/cancellation-attempts/${id}`, ""],
    ["POST", `/api/bff/v1/cancellation-attempts/${id}/verify`, ""],
    ["POST", `/api/bff/v1/cancellation-guides/${id}/feedback`, ""],
    ["GET", "/api/bff/v1/savings", `householdId=${id}&limit=25`],
  ])("allows a Milestone 4 route: %s %s?%s", (method, path, query) => {
    expect(
      resolveBffRoute(method, path, new URLSearchParams(query)),
    ).not.toBeNull();
  });

  it.each([
    ["GET", "/api/bff/v1/decisions/inbox", ""],
    ["GET", "/api/bff/v1/decisions/inbox", "householdId=not-a-uuid"],
    ["POST", `/api/bff/v1/decisions/inbox`, ""],
    ["POST", "/api/bff/v1/occurrences/not-a-uuid/decisions", ""],
    ["GET", `/api/bff/v1/commitments/${id}/cancellation-guide`, "url=evil"],
    [
      "GET",
      `/api/bff/v1/commitments/${id}/cancellation-attempts`,
      `householdId=${id}&limit=101`,
    ],
    ["PUT", `/api/bff/v1/cancellation-attempts/${id}`, ""],
    ["POST", `/api/bff/v1/cancellation-attempts/${id}/complete`, ""],
    ["GET", "/api/bff/v1/savings", `householdId=${id}&currency=INR`],
    ["GET", "/api/bff/v1/savings", `householdId=${id}&state=verified`],
    ["GET", "/api/bff/v1/cancellation-target", "url=https://safe.example"],
  ])(
    "rejects an unsafe Milestone 4 request: %s %s?%s",
    (method, path, query) => {
      expect(
        resolveBffRoute(method, path, new URLSearchParams(query)),
      ).toBeNull();
    },
  );

  it("uses operation-specific M4 header policies", () => {
    expect(
      resolveBffHeaderPolicy("POST", `/api/bff/v1/occurrences/${id}/decisions`),
    ).toEqual({ ifMatch: "forbidden", idempotencyKey: "required" });
    expect(
      resolveBffHeaderPolicy(
        "PATCH",
        `/api/bff/v1/cancellation-attempts/${id}`,
      ),
    ).toEqual({ ifMatch: "required", idempotencyKey: "forbidden" });
    expect(
      resolveBffHeaderPolicy(
        "POST",
        `/api/bff/v1/cancellation-attempts/${id}/verify`,
      ),
    ).toEqual({ ifMatch: "required", idempotencyKey: "required" });
    expect(
      resolveBffHeaderPolicy("GET", `/api/bff/v1/cancellation-attempts/${id}`),
    ).toEqual({ ifMatch: "forbidden", idempotencyKey: "forbidden" });
  });

  it.each([
    ["GET", `/api/bff/v1/households/${id}/members`],
    ["DELETE", `/api/bff/v1/households/${id}/members/${id}`],
    ["GET", `/api/bff/v1/households/${id}/invitations`],
    ["POST", `/api/bff/v1/households/${id}/invitations`],
    ["DELETE", `/api/bff/v1/households/${id}/invitations/${id}`],
    ["GET", "/api/bff/v1/household-invitations"],
    ["POST", "/api/bff/v1/household-invitations/accept"],
    ["PATCH", `/api/bff/v1/commitments/${id}/sharing`],
  ])("allows an exact M5 household route: %s %s", (method, path) => {
    expect(resolveBffRoute(method, path, new URLSearchParams())).toEqual({
      path: path.slice("/api/bff".length),
      search: "",
    });
  });

  it.each([
    ["GET", "/api/bff/v1/households/not-a-uuid/members"],
    ["POST", `/api/bff/v1/households/${id}/members`],
    ["DELETE", `/api/bff/v1/households/${id}/members/not-a-uuid`],
    ["GET", `/api/bff/v1/households/${id}/invitations?limit=101`],
    ["PATCH", `/api/bff/v1/households/${id}/invitations/${id}`],
    ["GET", "/api/bff/v1/household-invitations/accept"],
    ["POST", "/api/bff/v1/household-invitations/accept/"],
    ["PUT", `/api/bff/v1/commitments/${id}/sharing`],
    ["PATCH", `/api/bff/v1/commitments/${id}/sharing?role=OWNER`],
  ])("rejects an M5 household near miss: %s %s", (method, value) => {
    const url = new URL(value, "https://autopay-guard.test");
    expect(resolveBffRoute(method, url.pathname, url.searchParams)).toBeNull();
  });

  it.each([
    ["GET", "/api/bff/v1/households", `cursor=${id}&limit=25`],
    ["GET", `/api/bff/v1/households/${id}/members`, `cursor=${id}&limit=25`],
    [
      "GET",
      `/api/bff/v1/households/${id}/invitations`,
      `cursor=${id}&limit=25`,
    ],
    ["GET", "/api/bff/v1/household-invitations", `cursor=${id}&limit=25`],
    [
      "GET",
      "/api/bff/v1/privacy/notice-acknowledgements",
      `cursor=${id}&limit=25`,
    ],
    ["GET", "/api/bff/v1/privacy/consents", `cursor=${id}&limit=25`],
    [
      "GET",
      `/api/bff/v1/admin/cancellation-guides/${id}/versions`,
      `cursor=${id}&limit=25`,
    ],
  ])(
    "allows an exact paginated M5 collection: %s %s?%s",
    (method, path, query) => {
      expect(resolveBffRoute(method, path, new URLSearchParams(query))).toEqual(
        {
          path: path.slice("/api/bff".length),
          search: `cursor=${id}&limit=25`,
        },
      );
    },
  );

  it("keeps M5 route literals case-sensitive while accepting uppercase UUID hex", () => {
    const uppercaseId = "ABCDEF12-ABCD-4ABC-AABC-ABCDEF123456";
    expect(
      resolveBffRoute(
        "GET",
        `/api/bff/v1/households/${uppercaseId}/members`,
        new URLSearchParams({ cursor: uppercaseId, limit: "25" }),
      ),
    ).toEqual({
      path: `/v1/households/${uppercaseId}/members`,
      search: `cursor=${uppercaseId}&limit=25`,
    });
    expect(
      resolveBffRoute(
        "GET",
        `/api/bff/v1/Households/${uppercaseId}/members`,
        new URLSearchParams(),
      ),
    ).toBeNull();
    expect(
      resolveBffRoute(
        "GET",
        `/api/bff/v1/admin/Cancellation-guides/${uppercaseId}/versions`,
        new URLSearchParams(),
      ),
    ).toBeNull();
  });

  it("uses exact M5 household concurrency and replay header policies", () => {
    expect(
      resolveBffHeaderPolicy(
        "POST",
        `/api/bff/v1/households/${id}/invitations`,
      ),
    ).toEqual({ ifMatch: "forbidden", idempotencyKey: "forbidden" });
    expect(
      resolveBffHeaderPolicy(
        "POST",
        "/api/bff/v1/household-invitations/accept",
      ),
    ).toEqual({ ifMatch: "forbidden", idempotencyKey: "required" });
    expect(
      resolveBffHeaderPolicy(
        "DELETE",
        `/api/bff/v1/households/${id}/members/${id}`,
      ),
    ).toEqual({ ifMatch: "required", idempotencyKey: "forbidden" });
    expect(
      resolveBffHeaderPolicy("PATCH", `/api/bff/v1/commitments/${id}/sharing`),
    ).toEqual({ ifMatch: "required", idempotencyKey: "forbidden" });
  });

  it.each([
    ["GET", "/api/bff/v1/privacy/notices/current", ""],
    ["GET", "/api/bff/v1/privacy/notice-acknowledgements", ""],
    ["POST", "/api/bff/v1/privacy/notice-acknowledgements", ""],
    ["GET", "/api/bff/v1/privacy/consents", ""],
    ["POST", "/api/bff/v1/privacy/consents", ""],
    ["GET", "/api/bff/v1/privacy/requests", ""],
    ["POST", "/api/bff/v1/privacy/requests", ""],
    ["GET", `/api/bff/v1/privacy/requests/${id}`, ""],
    ["POST", `/api/bff/v1/privacy/requests/${id}/cancel`, ""],
    ["GET", `/api/bff/v1/privacy/requests/${id}/export`, ""],
    ["GET", "/api/bff/v1/admin/privacy/requests", ""],
    ["POST", `/api/bff/v1/admin/privacy/requests/${id}/execute`, ""],
    ["GET", "/api/bff/v1/admin/cancellation-guides", ""],
    ["GET", `/api/bff/v1/admin/cancellation-guides/${id}`, ""],
    ["GET", `/api/bff/v1/admin/cancellation-guides/${id}/versions`, ""],
    ["POST", `/api/bff/v1/admin/cancellation-guides/${id}/drafts`, ""],
    ["POST", `/api/bff/v1/admin/cancellation-guides/${id}/retire`, ""],
    ["GET", `/api/bff/v1/admin/cancellation-guide-drafts/${id}`, ""],
    ["PATCH", `/api/bff/v1/admin/cancellation-guide-drafts/${id}`, ""],
    ["POST", `/api/bff/v1/admin/cancellation-guide-drafts/${id}/publish`, ""],
    [
      "GET",
      "/api/bff/v1/admin/cancellation-guide-feedback",
      `cursor=${id}&limit=50`,
    ],
    ["POST", `/api/bff/v1/admin/cancellation-guide-feedback/${id}/review`, ""],
    ["GET", "/api/bff/v1/admin/audit-events", `cursor=${id}&limit=100`],
    ["POST", `/api/bff/v1/households/${id}/support-codes`, ""],
    ["DELETE", `/api/bff/v1/households/${id}/support-codes/${id}`, ""],
    ["POST", "/api/bff/v1/support/diagnostics/resolve", ""],
  ])("allows an exact M5 route: %s %s?%s", (method, path, query) => {
    expect(
      resolveBffRoute(method, path, new URLSearchParams(query)),
    ).not.toBeNull();
  });

  it.each([
    ["GET", "/api/bff/v1/privacy/notices/current/"],
    ["GET", "/api/bff/v1/privacy/requests/not-a-uuid"],
    ["GET", `/api/bff/v1/privacy/requests/${id}/export?filename=x.json`],
    ["POST", "/api/bff/v1/admin/privacy/requests/not-a-uuid/execute"],
    ["GET", "/api/bff/v1/admin/cancellation-guides?role=GUIDE_ADMIN"],
    ["POST", `/api/bff/v1/admin/cancellation-guide-drafts/${id}/retire`],
    ["GET", "/api/bff/v1/admin/cancellation-guide-feedback?cursor=opaque"],
    ["GET", "/api/bff/v1/admin/audit-events?limit=101"],
    ["POST", "/api/bff/v1/households/not-a-uuid/support-codes"],
    ["GET", "/api/bff/v1/support/diagnostics/resolve"],
    ["POST", "/api/bff/v1/support/account-lookup"],
  ])("rejects an M5 near miss: %s %s", (method, value) => {
    const url = new URL(value, "https://autopay-guard.test");
    expect(resolveBffRoute(method, url.pathname, url.searchParams)).toBeNull();
  });

  it("uses exact M5 body and conditional-header policies", () => {
    expect(
      resolveBffBodyPolicy("POST", `/api/bff/v1/privacy/requests/${id}/cancel`),
    ).toBe("forbidden");
    expect(
      resolveBffBodyPolicy(
        "POST",
        `/api/bff/v1/admin/cancellation-guides/${id}/drafts`,
      ),
    ).toBe("forbidden");
    expect(
      resolveBffBodyPolicy(
        "PATCH",
        `/api/bff/v1/admin/cancellation-guide-drafts/${id}`,
      ),
    ).toBe("required");
    expect(
      resolveBffHeaderPolicy(
        "POST",
        `/api/bff/v1/admin/cancellation-guide-drafts/${id}/publish`,
      ),
    ).toEqual({ ifMatch: "required", idempotencyKey: "required" });
    expect(
      resolveBffHeaderPolicy(
        "POST",
        `/api/bff/v1/households/${id}/support-codes`,
      ),
    ).toEqual({ ifMatch: "forbidden", idempotencyKey: "forbidden" });
  });
});
