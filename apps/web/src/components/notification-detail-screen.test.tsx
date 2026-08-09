import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationDetailScreen } from "@/components/notification-detail-screen";
import type { NotificationDto } from "@/lib/notification-api";

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

const notification: NotificationDto = {
  id: "00000000-0000-4000-8000-000000000030",
  householdId: household.id,
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

describe("NotificationDetailScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a notification read with its current quoted version", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(notification))
      .mockResolvedValueOnce(
        jsonResponse({ ...notification, read: true, version: 2 }),
      );

    render(<NotificationDetailScreen notificationId={notification.id} />);

    await user.click(await screen.findByRole("button", { name: "Mark read" }));

    expect(await screen.findByText("Notification marked read.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark unread" })).toBeVisible();
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    expect(JSON.parse(String(init?.body))).toEqual({ read: true });
  });

  it("reloads the latest notification after a 412 before retrying", async () => {
    const user = userEvent.setup();
    const latest = { ...notification, read: true, version: 2 };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(notification))
      .mockResolvedValueOnce(problemResponse(412))
      .mockResolvedValueOnce(jsonResponse(latest))
      .mockResolvedValueOnce(
        jsonResponse({ ...latest, read: false, version: 3 }),
      );

    render(<NotificationDetailScreen notificationId={notification.id} />);

    await user.click(await screen.findByRole("button", { name: "Mark read" }));
    expect(await screen.findByText("A newer version exists")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Reload latest version" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mark unread" })).toBeVisible(),
    );
    await user.click(screen.getByRole("button", { name: "Mark unread" }));
    await screen.findByText("Notification marked unread.");

    const [, retryInit] = fetchMock.mock.calls[3] ?? [];
    expect(new Headers(retryInit?.headers).get("if-match")).toBe('"2"');
    expect(JSON.parse(String(retryInit?.body))).toEqual({ read: false });
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
