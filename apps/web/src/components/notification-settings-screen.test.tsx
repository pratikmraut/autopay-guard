import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationSettingsScreen } from "@/components/notification-settings-screen";
import type {
  NotificationDiagnosticsDto,
  NotificationPreferencesDto,
  ReminderRulesDto,
} from "@/lib/notification-api";

const household: Household = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Demo household",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  accessRole: "OWNER",
  canManage: true,
};

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

const syntheticPreferences: NotificationPreferencesDto = {
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

const syntheticRules: ReminderRulesDto = {
  id: null,
  householdId: household.id,
  commitmentId: null,
  mode: "DISABLED",
  rules: [],
  suggestedRules: [
    {
      channel: "IN_APP",
      offsetDays: 7,
      localSendTime: "09:00",
      enabled: true,
    },
  ],
  version: 0,
  updatedAt: null,
};

const diagnostics: NotificationDiagnosticsDto = {
  householdId: household.id,
  pendingCount: 0,
  processingCount: 0,
  retryScheduledCount: 0,
  deliveredCount: 0,
  deadCount: 0,
  suppressedCount: 0,
  oldestPendingAgeSeconds: null,
  nextRetryAt: null,
  failures: [],
};

describe("NotificationSettingsScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates explicitly enabled preferences from synthetic version zero", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/notification-preferences")) {
          return init?.method === "PUT"
            ? jsonResponse({
                ...syntheticPreferences,
                id: "00000000-0000-4000-8000-000000000040",
                enabled: true,
                inAppEnabled: true,
                version: 1,
                updatedAt: "2026-07-26T15:30:00Z",
              })
            : jsonResponse(syntheticPreferences);
        }
        if (url.includes("/reminder-rules")) {
          return jsonResponse(syntheticRules);
        }
        return jsonResponse(diagnostics);
      });

    render(<NotificationSettingsScreen />);

    await user.click(
      await screen.findByRole("checkbox", { name: /Enable reminders/i }),
    );
    await user.click(screen.getByRole("checkbox", { name: /In-app inbox/i }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    await screen.findByText("Notification preferences saved.");
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/v1/notification-preferences") &&
        init?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const [, init] = putCall ?? [];
    expect(new Headers(init?.headers).get("if-match")).toBe('"0"');
    expect(JSON.parse(String(init?.body))).toEqual({
      enabled: true,
      inAppEnabled: true,
      emailEnabled: false,
      timezone: "Asia/Kolkata",
      quietHoursEnabled: false,
      quietStart: null,
      quietEnd: null,
    });
  });

  it("reloads and remounts the latest preference version after a 412", async () => {
    const user = userEvent.setup();
    let preferenceGets = 0;
    let preferencePuts = 0;
    const latest = {
      ...syntheticPreferences,
      id: "00000000-0000-4000-8000-000000000040",
      enabled: true,
      version: 1,
      updatedAt: "2026-07-26T15:30:00Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/notification-preferences")) {
          if (init?.method === "PUT") {
            preferencePuts += 1;
            if (preferencePuts === 1) {
              return problemResponse(412);
            }
            return jsonResponse({ ...latest, version: 2 });
          }
          preferenceGets += 1;
          return jsonResponse(
            preferenceGets === 1 ? syntheticPreferences : latest,
          );
        }
        if (url.includes("/reminder-rules")) {
          return jsonResponse(syntheticRules);
        }
        return jsonResponse(diagnostics);
      });

    render(<NotificationSettingsScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Save preferences" }),
    );
    expect(await screen.findByText("A newer version exists")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Reload latest version" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: /Enable reminders/i }),
      ).toBeChecked(),
    );
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await screen.findByText("Notification preferences saved.");

    const putCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith("/v1/notification-preferences") &&
        init?.method === "PUT",
    );
    expect(new Headers(putCalls[1]?.[1]?.headers).get("if-match")).toBe('"1"');
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function problemResponse(status: number) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Precondition Failed",
      status,
      detail: "The version is stale.",
    }),
    {
      status,
      headers: { "content-type": "application/problem+json" },
    },
  );
}
