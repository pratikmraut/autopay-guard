import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentSharingPanel } from "@/components/commitment-sharing-panel";
import type {
  HouseholdCommitmentDto,
  HouseholdMemberDto,
} from "@/lib/household-api";

const householdId = "00000000-0000-4000-8000-000000000010";
const commitmentId = "00000000-0000-4000-8000-000000000020";
const memberId = "00000000-0000-4000-8000-000000000030";

const member: HouseholdMemberDto = {
  id: memberId,
  userId: "00000000-0000-4000-8000-000000000031",
  displayName: "Demo Member",
  role: "MEMBER",
  status: "ACTIVE",
  version: 0,
  joinedAt: "2026-07-28T00:00:00Z",
  removedAt: null,
};

const commitment: HouseholdCommitmentDto = {
  id: commitmentId,
  householdId,
  dataOwnerUserId: "00000000-0000-4000-8000-000000000001",
  responsibleMemberId: null,
  merchantId: null,
  merchantCanonicalName: null,
  displayName: "Fictional plan",
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
  visibility: "PRIVATE",
  status: "ACTIVE",
  version: 3,
  canManage: true,
  reviewActions: ["KEEP"],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("CommitmentSharingPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits an exact owner-controlled sharing choice and planning label", async () => {
    const user = userEvent.setup();
    const updated: HouseholdCommitmentDto = {
      ...commitment,
      visibility: "HOUSEHOLD",
      responsibleMemberId: memberId,
      version: 4,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ items: [member] }))
      .mockResolvedValueOnce(jsonResponse(updated));
    const onUpdated = vi.fn();
    const onReload = vi.fn();

    const { rerender } = render(
      <CommitmentSharingPanel
        commitment={commitment}
        onReload={onReload}
        onUpdated={onUpdated}
      />,
    );

    const householdChoice = await screen.findByRole("radio", {
      name: /^Household /i,
    });
    await user.click(householdChoice);
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: /optional planning responsibility/i,
      }),
      memberId,
    );
    await user.click(screen.getByRole("button", { name: "Save visibility" }));

    expect(onUpdated).toHaveBeenCalledWith(updated);
    const [, patchInit] = fetchMock.mock.calls[1] ?? [];
    expect(new Headers(patchInit?.headers).get("if-match")).toBe('"3"');
    expect(JSON.parse(String(patchInit?.body))).toEqual({
      visibility: "HOUSEHOLD",
      responsibleMemberId: memberId,
    });
    await act(async () => {
      rerender(
        <CommitmentSharingPanel
          commitment={updated}
          onReload={onReload}
          onUpdated={onUpdated}
        />,
      );
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "visible read-only to currently consented household members",
    );
    expect(screen.getByText(/planning label only/i)).toBeVisible();
  });

  it("renders a member view without owner mutation controls", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ items: [member] }),
    );

    render(
      <CommitmentSharingPanel
        commitment={{
          ...commitment,
          canManage: false,
          visibility: "HOUSEHOLD",
          responsibleMemberId: memberId,
        }}
        onReload={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        (_content, element) =>
          element?.tagName === "SMALL" &&
          element.textContent?.includes("Demo Member") === true,
      ),
    ).toBeVisible();
    expect(screen.getByText("Shared with this household")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /save visibility/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText(/only the household owner/i)).toBeVisible();
  });

  it("loads another member page for the owner responsibility control", async () => {
    const user = userEvent.setup();
    const secondMember = {
      ...member,
      id: "00000000-0000-4000-8000-000000000040",
      userId: "00000000-0000-4000-8000-000000000041",
      displayName: "Second Demo Member",
    };
    const cursor = "00000000-0000-4000-8000-000000000099";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ items: [member], nextCursor: cursor }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [secondMember], nextCursor: null }),
      );

    render(
      <CommitmentSharingPanel
        commitment={commitment}
        onReload={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Load more household members",
      }),
    );

    expect(
      screen.getByRole("option", { name: "Second Demo Member" }),
    ).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`cursor=${cursor}`);
    expect(
      screen.queryByRole("button", {
        name: "Load more household members",
      }),
    ).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
