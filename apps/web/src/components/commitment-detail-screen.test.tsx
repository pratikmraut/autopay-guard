import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentDetailScreen } from "@/components/commitment-detail-screen";

const householdId = "00000000-0000-4000-8000-000000000010";
const commitmentId = "00000000-0000-4000-8000-000000000020";
const memberId = "00000000-0000-4000-8000-000000000030";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => ({
    id: householdId,
    name: "Demo household",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    defaultCurrency: "INR",
    timezone: "Asia/Kolkata",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    accessRole: "MEMBER",
    canManage: false,
  }),
}));

describe("CommitmentDetailScreen household member view", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    navigation.refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a shared commitment read-only without owner controls", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `/api/bff/v1/commitments/${commitmentId}`) {
        return jsonResponse({
          id: commitmentId,
          householdId,
          dataOwnerUserId: "00000000-0000-4000-8000-000000000001",
          responsibleMemberId: memberId,
          merchantId: null,
          merchantCanonicalName: null,
          displayName: "Shared fictional plan",
          category: "SUBSCRIPTION",
          paymentRail: "CARD_RECURRING",
          amountMinor: 50000,
          estimatedAmountMinor: null,
          currency: "INR",
          frequency: "MONTHLY",
          intervalCount: 1,
          customIntervalUnit: null,
          anchorDate: "2026-07-15",
          monthDayPolicy: "ANCHOR_DAY",
          nextDueDate: "2026-08-15",
          variableAmount: false,
          maskedPaymentLabel: null,
          source: "MANUAL",
          sourceConfidence: null,
          visibility: "HOUSEHOLD",
          status: "ACTIVE",
          version: 3,
          canManage: false,
          reviewActions: ["CANCEL_WITH_PROVIDER"],
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
        });
      }
      if (url === `/api/bff/v1/households/${householdId}/members`) {
        return jsonResponse({
          items: [
            {
              id: memberId,
              userId: memberId,
              displayName: "Demo Member",
              role: "MEMBER",
              status: "ACTIVE",
              version: 0,
              joinedAt: "2026-07-28T00:00:00Z",
              removedAt: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<CommitmentDetailScreen commitmentId={commitmentId} />);

    expect(await screen.findByText("Shared fictional plan")).toBeVisible();
    expect(screen.getByText("Read-only household view")).toBeVisible();
    expect(
      await screen.findByText(
        (_content, element) =>
          element?.tagName === "SMALL" &&
          element.textContent?.includes("Demo Member") === true,
      ),
    ).toBeVisible();
    expect(
      screen.queryByTestId("edit-commitment-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("archive-commitment-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("commitment-reminders-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cancellation-guide-link"),
    ).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
