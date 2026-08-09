import { ApiClientError } from "@autopay-guard/contracts";
import { describe, expect, it, vi } from "vitest";

import { HouseholdApi } from "@/lib/household-api";

const householdId = "00000000-0000-4000-8000-000000000010";
const memberId = "00000000-0000-4000-8000-000000000011";
const invitationId = "00000000-0000-4000-8000-000000000012";
const commitmentId = "00000000-0000-4000-8000-000000000013";

describe("HouseholdApi", () => {
  it("forwards only bounded collection cursor and limit parameters", async () => {
    const cursor = "00000000-0000-4000-8000-000000000099";
    const fetchApi = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ items: [], nextCursor: null }),
      );
    const api = new HouseholdApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.listHouseholds({ cursor, limit: 25 });
    await api.listMembers(householdId, { cursor, limit: 25 });
    await api.listHouseholdInvitations(householdId, { cursor, limit: 25 });
    await api.listIncomingInvitations({ cursor, limit: 25 });

    expect(fetchApi.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/bff/v1/households?limit=25&cursor=${cursor}`,
      `/api/bff/v1/households/${householdId}/members?limit=25&cursor=${cursor}`,
      `/api/bff/v1/households/${householdId}/invitations?limit=25&cursor=${cursor}`,
      `/api/bff/v1/household-invitations?limit=25&cursor=${cursor}`,
    ]);
  });

  it("creates a local invitation without an idempotency header", async () => {
    const fetchApi = vi.fn().mockResolvedValue(
      jsonResponse({
        invitation: {
          id: invitationId,
          householdId,
          householdName: "Demo household",
          inviteeEmail: "member@autopayguard.local",
          status: "PENDING",
          version: 0,
          expiresAt: "2026-07-29T00:00:00Z",
          createdAt: "2026-07-28T00:00:00Z",
        },
        invitationCode: "a".repeat(43),
        emailSent: false,
      }),
    );
    const api = new HouseholdApi({
      baseUrl: "/api/bff/",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.createInvitation(householdId, "member@autopayguard.local");

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe(`/api/bff/v1/households/${householdId}/invitations`);
    expect(init?.method).toBe("POST");
    expect(headers.get("idempotency-key")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      inviteeEmail: "member@autopayguard.local",
    });
  });

  it("accepts a code with an idempotency key and no URL disclosure", async () => {
    const code = "b".repeat(43);
    const fetchApi = vi.fn().mockResolvedValue(
      jsonResponse({
        id: memberId,
        userId: memberId,
        displayName: "Demo Member",
        role: "MEMBER",
        status: "ACTIVE",
        version: 0,
        joinedAt: "2026-07-28T00:00:00Z",
        removedAt: null,
      }),
    );
    const api = new HouseholdApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.acceptInvitation(code, "m5-accept-00000000-0000-4000-8000-1");

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe("/api/bff/v1/household-invitations/accept");
    expect(String(url)).not.toContain(code);
    expect(headers.get("idempotency-key")).toBe(
      "m5-accept-00000000-0000-4000-8000-1",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      invitationCode: code,
    });
  });

  it("uses quoted versions for removal, revocation, and sharing", async () => {
    const fetchApi = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ id: commitmentId, version: 4 }));
    const api = new HouseholdApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.removeMember(householdId, memberId, '"2"');
    await api.revokeInvitation(householdId, invitationId, '"3"');
    await api.updateCommitmentSharing(commitmentId, '"3"', {
      visibility: "HOUSEHOLD",
      responsibleMemberId: memberId,
    });

    expect(
      new Headers(fetchApi.mock.calls[0]?.[1]?.headers).get("if-match"),
    ).toBe('"2"');
    expect(
      new Headers(fetchApi.mock.calls[1]?.[1]?.headers).get("if-match"),
    ).toBe('"3"');
    expect(
      new Headers(fetchApi.mock.calls[2]?.[1]?.headers).get("if-match"),
    ).toBe('"3"');
    expect(JSON.parse(String(fetchApi.mock.calls[2]?.[1]?.body))).toEqual({
      visibility: "HOUSEHOLD",
      responsibleMemberId: memberId,
    });
  });

  it("preserves safe API problem details for UI status handling", async () => {
    const fetchApi = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Precondition Failed",
          status: 412,
          detail: "Reload the latest version.",
          correlationId: "safe-correlation",
        }),
        {
          status: 412,
          headers: {
            "content-type": "application/problem+json",
            "x-correlation-id": "safe-correlation",
          },
        },
      ),
    );
    const api = new HouseholdApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await expect(
      api.removeMember(householdId, memberId, '"1"'),
    ).rejects.toMatchObject({
      status: 412,
      correlationId: "safe-correlation",
    } satisfies Partial<ApiClientError>);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
