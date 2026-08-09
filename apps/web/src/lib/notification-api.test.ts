import { describe, expect, it, vi } from "vitest";

import {
  NotificationApi,
  type NotificationDto,
  type NotificationPreferencesDto,
  type ReminderRulesDto,
} from "@/lib/notification-api";

const preferences: NotificationPreferencesDto = {
  id: null,
  enabled: false,
  inAppEnabled: false,
  emailEnabled: false,
  timezone: "Asia/Kolkata",
  quietHoursEnabled: false,
  quietStart: null,
  quietEnd: null,
  version: 0,
  updatedAt: null,
};

const rules: ReminderRulesDto = {
  id: null,
  householdId: "00000000-0000-4000-8000-000000000010",
  commitmentId: null,
  mode: "DISABLED",
  rules: [],
  suggestedRules: [],
  version: 0,
  updatedAt: null,
};

const notification: NotificationDto = {
  id: "00000000-0000-4000-8000-000000000030",
  householdId: rules.householdId,
  commitmentId: "00000000-0000-4000-8000-000000000020",
  scheduledDate: "2026-08-01",
  channel: "IN_APP",
  offsetDays: 3,
  plannedFor: "2026-07-29T03:30:00Z",
  status: "DELIVERED",
  read: false,
  version: 1,
  failureCategory: "NONE",
  nextAttemptAt: null,
  deliveredAt: "2026-07-29T03:30:03Z",
  createdAt: "2026-07-29T03:30:00Z",
};

describe("NotificationApi", () => {
  it("creates synthetic preferences with an exact full PUT and If-Match zero", async () => {
    const fetchApi = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ...preferences, id: notification.id, version: 1 }),
      );
    const api = new NotificationApi({
      baseUrl: "/api/bff/",
      fetchApi: fetchApi as typeof fetch,
    });
    const body = {
      enabled: true,
      inAppEnabled: true,
      emailEnabled: false,
      timezone: "Asia/Kolkata",
      quietHoursEnabled: false,
      quietStart: null,
      quietEnd: null,
    };

    await api.putPreferences('"0"', body);

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe("/api/bff/v1/notification-preferences");
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("if-match")).toBe('"0"');
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(String(init?.body)).not.toContain("recipient");
    expect(String(init?.body)).not.toContain("householdId");
  });

  it("uses a full rule PUT scoped only by the path", async () => {
    const fetchApi = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...rules, version: 2 }));
    const api = new NotificationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.putHouseholdRules(rules.householdId, '"1"', {
      mode: "CUSTOM",
      rules: [
        {
          channel: "EMAIL",
          offsetDays: 7,
          localSendTime: "09:00",
          enabled: true,
        },
      ],
    });

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/bff/v1/households/${rules.householdId}/reminder-rules`,
    );
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: "CUSTOM",
      rules: [
        {
          channel: "EMAIL",
          offsetDays: 7,
          localSendTime: "09:00",
          enabled: true,
        },
      ],
    });
  });

  it("encodes only the supported inbox query and preserves a cursor", async () => {
    const fetchApi = vi.fn().mockResolvedValue(
      jsonResponse({
        householdId: rules.householdId,
        filter: "FAILED",
        items: [],
        nextCursor: null,
      }),
    );
    const api = new NotificationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.listNotifications({
      householdId: rules.householdId,
      filter: "FAILED",
      cursor: "next_page-2",
      limit: 25,
    });

    const requestUrl = new URL(
      String(fetchApi.mock.calls[0]?.[0]),
      "https://autopay-guard.test",
    );
    expect(requestUrl.pathname).toBe("/api/bff/v1/notifications");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      householdId: rules.householdId,
      filter: "FAILED",
      limit: "25",
      cursor: "next_page-2",
    });
  });

  it("sends a versioned PATCH containing only the read choice", async () => {
    const fetchApi = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ...notification, read: true, version: 2 }),
      );
    const api = new NotificationApi({
      baseUrl: "/api/bff",
      fetchApi: fetchApi as typeof fetch,
    });

    await api.patchNotificationRead(notification.id, '"1"', true);

    const [url, init] = fetchApi.mock.calls[0] ?? [];
    expect(url).toBe(`/api/bff/v1/notifications/${notification.id}`);
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    expect(JSON.parse(String(init?.body))).toEqual({ read: true });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
