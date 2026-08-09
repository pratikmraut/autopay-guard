import { act, render, screen } from "@testing-library/react";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationInboxScreen } from "@/components/notification-inbox-screen";
import type { NotificationDto } from "@/lib/notification-api";

const scopeMocks = vi.hoisted(() => ({
  household: {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Workspace A",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    defaultCurrency: "INR",
    timezone: "Asia/Kolkata",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  } as Household,
  filter: "FAILED",
}));

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => scopeMocks.household,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      scopeMocks.filter === "ALL" ? "" : `filter=${scopeMocks.filter}`,
    ),
}));

const notification: NotificationDto = {
  id: "00000000-0000-4000-8000-000000000030",
  householdId: scopeMocks.household.id,
  commitmentId: "00000000-0000-4000-8000-000000000020",
  scheduledDate: "2026-08-01",
  channel: "EMAIL",
  offsetDays: 3,
  plannedFor: "2026-07-29T03:30:00Z",
  status: "DEAD",
  read: false,
  version: 1,
  failureCategory: "PROVIDER_PERMANENT",
  nextAttemptAt: null,
  deliveredAt: null,
  createdAt: "2026-07-29T03:30:00Z",
};

describe("NotificationInboxScreen", () => {
  beforeEach(() => {
    scopeMocks.household = {
      ...scopeMocks.household,
      id: "00000000-0000-4000-8000-000000000010",
      name: "Workspace A",
    };
    scopeMocks.filter = "FAILED";
    vi.restoreAllMocks();
  });

  it("uses the exact failed filter and renders only safe delivery state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        householdId: scopeMocks.household.id,
        filter: "FAILED",
        items: [notification],
        nextCursor: null,
      }),
    );

    render(<NotificationInboxScreen />);

    expect(await screen.findByText("Delivery failed")).toBeVisible();
    expect(screen.getByText("Permanent delivery issue")).toBeVisible();
    expect(screen.getByRole("link", { name: "Failed" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/bff/v1/notifications?householdId=${scopeMocks.household.id}&filter=FAILED&limit=25`,
    );
    expect(
      screen.queryByRole("textbox", { name: /email address/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry delivery/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/attempt count/i)).not.toBeInTheDocument();
  });

  it("hides a previous workspace immediately and rejects mismatched rows", async () => {
    scopeMocks.filter = "ALL";
    let resolveWorkspaceB!: (response: Response) => void;
    const workspaceBResponse = new Promise<Response>((resolve) => {
      resolveWorkspaceB = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          householdId: scopeMocks.household.id,
          filter: "ALL",
          items: [{ ...notification, status: "DELIVERED" }],
          nextCursor: null,
        }),
      )
      .mockReturnValueOnce(workspaceBResponse);

    const view = render(<NotificationInboxScreen />);
    expect(await screen.findByText("Delivered")).toBeVisible();

    scopeMocks.household = {
      ...scopeMocks.household,
      id: "00000000-0000-4000-8000-000000000011",
      name: "Workspace B",
    };
    view.rerender(<NotificationInboxScreen />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading notifications",
    );
    expect(screen.queryByText("Delivered")).not.toBeInTheDocument();

    await act(async () => {
      resolveWorkspaceB(
        jsonResponse({
          householdId: scopeMocks.household.id,
          filter: "ALL",
          items: [notification],
          nextCursor: null,
        }),
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notification service could not return this information.",
    );
    expect(screen.queryByText("Delivery failed")).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
