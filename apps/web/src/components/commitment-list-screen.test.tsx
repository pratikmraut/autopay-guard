import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Commitment, Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentListScreen } from "@/components/commitment-list-screen";

const scopeMocks = vi.hoisted(() => ({
  household: {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Workspace A",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    defaultCurrency: "INR",
    timezone: "Asia/Kolkata",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    accessRole: "OWNER",
    canManage: true,
  } as Household,
}));

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => scopeMocks.household,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const commitmentA: Commitment = {
  id: "00000000-0000-4000-8000-000000000020",
  householdId: "00000000-0000-4000-8000-000000000010",
  dataOwnerUserId: "00000000-0000-4000-8000-000000000001",
  responsibleMemberId: null,
  merchantId: null,
  merchantCanonicalName: null,
  displayName: "Workspace A plan",
  category: "SUBSCRIPTION",
  paymentRail: "CARD_RECURRING",
  amountMinor: 49900,
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
  visibility: "PRIVATE",
  status: "ACTIVE",
  version: 1,
  canManage: true,
  reviewActions: ["KEEP"],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("CommitmentListScreen", () => {
  beforeEach(() => {
    scopeMocks.household = {
      ...scopeMocks.household,
      id: "00000000-0000-4000-8000-000000000010",
      name: "Workspace A",
    };
    vi.restoreAllMocks();
  });

  it("keeps loaded rows and offers a safe retry after pagination fails", async () => {
    const user = userEvent.setup();
    const commitmentB = {
      ...commitmentA,
      id: "00000000-0000-4000-8000-000000000021",
      displayName: "Second page plan",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ items: [commitmentA], nextCursor: "next-page" }),
      )
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(
        jsonResponse({ items: [commitmentB], nextCursor: null }),
      );

    render(<CommitmentListScreen />);
    expect(await screen.findByText("Workspace A plan")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Load more commitments" }),
    );

    const paginationHeading = await screen.findByText(
      "More commitments unavailable",
    );
    expect(paginationHeading.closest('[role="alert"]')).toHaveTextContent(
      "The next page could not be loaded. The commitments already shown are unchanged.",
    );
    expect(screen.getByText("Workspace A plan")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Try loading more commitments" }),
    );
    expect(await screen.findByText("Second page plan")).toBeVisible();
    expect(
      screen.queryByText("More commitments unavailable"),
    ).not.toBeInTheDocument();
  });

  it("hides the old scope immediately and rejects mismatched response rows", async () => {
    let resolveWorkspaceB!: (response: Response) => void;
    const workspaceBResponse = new Promise<Response>((resolve) => {
      resolveWorkspaceB = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ items: [commitmentA], nextCursor: null }),
      )
      .mockReturnValueOnce(workspaceBResponse);

    const view = render(<CommitmentListScreen />);
    expect(await screen.findByText("Workspace A plan")).toBeVisible();

    scopeMocks.household = {
      ...scopeMocks.household,
      id: "00000000-0000-4000-8000-000000000011",
      name: "Workspace B",
    };
    view.rerender(<CommitmentListScreen />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading recurring commitments",
    );
    expect(screen.queryByText("Workspace A plan")).not.toBeInTheDocument();

    await act(async () => {
      resolveWorkspaceB(
        jsonResponse({
          items: [
            {
              ...commitmentA,
              displayName: "Mismatched workspace plan",
            },
          ],
          nextCursor: null,
        }),
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The API could not return this workspace's commitments.",
    );
    expect(
      screen.queryByText("Mismatched workspace plan"),
    ).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
