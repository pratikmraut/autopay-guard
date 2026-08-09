import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Commitment, Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentEditScreen } from "@/components/commitment-edit-screen";

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

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const original: Commitment = {
  id: "00000000-0000-4000-8000-000000000020",
  householdId: household.id,
  dataOwnerUserId: household.ownerUserId,
  responsibleMemberId: null,
  merchantId: null,
  merchantCanonicalName: null,
  displayName: "Original value",
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
  version: 7,
  canManage: true,
  reviewActions: ["KEEP", "REVIEW"],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("CommitmentEditScreen", () => {
  beforeEach(() => {
    routerMocks.push.mockReset();
    routerMocks.refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("replaces stale fields and ETag with the reloaded version after a 412", async () => {
    const user = userEvent.setup();
    const latest = {
      ...original,
      displayName: "Changed elsewhere",
      amountMinor: 79900,
      version: 8,
      updatedAt: "2026-07-26T12:00:00Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(original))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Precondition Failed",
            status: 412,
            detail: "The version is stale.",
          }),
          {
            status: 412,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(latest))
      .mockResolvedValueOnce(jsonResponse(latest));

    render(<CommitmentEditScreen commitmentId={original.id} />);

    expect(await screen.findByLabelText(/^Display name/)).toHaveValue(
      "Original value",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("A newer version exists")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Reload latest version" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/^Display name/)).toHaveValue(
        "Changed elsewhere",
      ),
    );
    expect(screen.getByLabelText(/^Fixed amount/)).toHaveValue("799.00");
    expect(
      screen.queryByText("A newer version exists"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [, retryRequest] = fetchMock.mock.calls[3] ?? [];
    expect(new Headers(retryRequest?.headers).get("if-match")).toBe('"8"');
    expect(JSON.parse(String(retryRequest?.body))).toMatchObject({
      displayName: "Changed elsewhere",
      amountMinor: 79900,
      currency: "INR",
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
