import { render, screen, within } from "@testing-library/react";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SavingsDashboardScreen } from "@/components/savings-dashboard-screen";
import { formatMinorMoney } from "@/lib/money";

const household: Household = {
  id: "00000000-0000-4000-8000-000000000091",
  name: "Demo household",
  ownerUserId: "00000000-0000-4000-8000-000000000092",
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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

describe("SavingsDashboardScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps currencies and evidence states separate while preserving unknowns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        householdId: household.id,
        asOf: "2026-07-27T12:00:00Z",
        currencies: [
          {
            currency: "INR",
            totals: [
              {
                state: "POTENTIAL",
                exactAmountMinor: 120000,
                estimatedAmountMinor: 45000,
                exactAttemptCount: 1,
                estimatedAttemptCount: 2,
              },
              {
                state: "VERIFIED",
                exactAmountMinor: 0,
                estimatedAmountMinor: 90000,
                exactAttemptCount: 0,
                estimatedAttemptCount: 1,
              },
            ],
          },
          {
            currency: "USD",
            totals: [
              {
                state: "SELF_REPORTED",
                exactAmountMinor: 2500,
                estimatedAmountMinor: 0,
                exactAttemptCount: 1,
                estimatedAttemptCount: 0,
              },
            ],
          },
        ],
        unquantifiedCount: 1,
        items: [
          {
            attemptId: "00000000-0000-4000-8000-000000000093",
            commitmentId: "00000000-0000-4000-8000-000000000094",
            displayName: "Unknown utility",
            state: "POTENTIAL",
            amountMinor: null,
            currency: "INR",
            estimated: false,
            periodStart: "2026-07-28",
            periodEnd: "2027-07-27",
            reversalReason: null,
            updatedAt: "2026-07-27T12:00:00Z",
          },
        ],
        nextCursor: null,
      }),
    );

    render(<SavingsDashboardScreen />);

    const inr = (await screen.findByRole("heading", { name: "INR" })).closest(
      "section",
    );
    const usd = screen.getByRole("heading", { name: "USD" }).closest("section");
    expect(inr).not.toBeNull();
    expect(usd).not.toBeNull();

    const potential = within(inr!)
      .getByText("Potential only")
      .closest("article");
    expect(potential).not.toBeNull();
    expect(
      within(potential!).getByText(formatMinorMoney(120000, "INR")),
    ).toBeVisible();
    expect(within(potential!).getByText("Exact projection")).toBeVisible();
    expect(
      within(potential!).getByText(`≈ ${formatMinorMoney(45000, "INR")}`),
    ).toBeVisible();
    expect(
      within(potential!).getByText("1 exact current attempt"),
    ).toBeVisible();
    expect(
      within(potential!).getByText("2 estimated current attempts"),
    ).toBeVisible();
    expect(
      within(potential!).queryByText(formatMinorMoney(165000, "INR")),
    ).not.toBeInTheDocument();

    const verified = within(inr!)
      .getByText("User-confirmed after due date")
      .closest("article");
    expect(verified).not.toBeNull();
    expect(
      within(verified!).getByText(`≈ ${formatMinorMoney(90000, "INR")}`),
    ).toBeVisible();
    expect(within(usd!).getByText(formatMinorMoney(2500, "USD"))).toBeVisible();
    expect(
      screen.getAllByText(
        "These four states and their exact/estimated buckets are mutually separated and are not summed.",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("1 unquantified attempt(s)")).toBeVisible();
    expect(screen.getByText("Unquantified")).toBeVisible();
    expect(
      screen.getByText(/not represented as zero in any total/),
    ).toBeVisible();
    expect(screen.queryByText(/total saved/i)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/bff/v1/savings?householdId=${household.id}&limit=25`,
    );
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
