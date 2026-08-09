import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardSummaryContent } from "@/components/dashboard-screen";

const householdId = "00000000-0000-4000-8000-000000000123";

describe("DashboardSummaryContent", () => {
  it("keeps the empty state available without assuming an empty database", () => {
    render(
      <DashboardSummaryContent
        householdId={householdId}
        summary={{
          householdId,
          month: "2026-07",
          activeCommitmentCount: 0,
          variableCommitmentCount: 0,
          unknownVariableCommitmentCount: 0,
          monthlyProjection: emptyProjection("2026-07-01", "2026-07-31"),
          annualizedProjection: emptyProjection("2026-07-01", "2027-06-30"),
        }}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "No recurring commitments yet",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Add a commitment" }),
    ).toHaveAttribute("href", `/commitments/new?householdId=${householdId}`);
  });

  it("shows exact fixed, estimated, and unknown values without FX", () => {
    render(
      <DashboardSummaryContent
        householdId={householdId}
        summary={{
          householdId,
          month: "2026-07",
          activeCommitmentCount: 5,
          variableCommitmentCount: 2,
          unknownVariableCommitmentCount: 1,
          monthlyProjection: {
            from: "2026-07-01",
            to: "2026-07-31",
            occurrenceCount: 5,
            unknownVariableOccurrenceCount: 1,
            totals: [
              {
                currency: "INR",
                fixedAmountMinor: 250000,
                estimatedVariableAmountMinor: 200000,
                knownTotalMinor: 450000,
                fixedOccurrenceCount: 3,
                estimatedVariableOccurrenceCount: 1,
                unknownVariableOccurrenceCount: 1,
                containsEstimates: true,
              },
            ],
          },
          annualizedProjection: {
            from: "2026-07-01",
            to: "2027-06-30",
            occurrenceCount: 60,
            unknownVariableOccurrenceCount: 12,
            totals: [
              {
                currency: "INR",
                fixedAmountMinor: 3000000,
                estimatedVariableAmountMinor: 2400000,
                knownTotalMinor: 5400000,
                fixedOccurrenceCount: 36,
                estimatedVariableOccurrenceCount: 12,
                unknownVariableOccurrenceCount: 12,
                containsEstimates: true,
              },
            ],
          },
        }}
      />,
    );

    const month = screen
      .getByRole("heading", { name: "July 2026" })
      .closest("article");
    expect(month).not.toBeNull();
    expect(within(month!).getByText("₹4,500")).toBeVisible();
    expect(within(month!).getByText("₹2,500")).toBeVisible();
    expect(within(month!).getByText("≈ ₹2,000")).toBeVisible();
    expect(within(month!).getByText("Excluded from known total")).toBeVisible();
    for (const group of month!.querySelectorAll("dl > div")) {
      expect(
        [...group.children].every(
          (child) => child.tagName === "DT" || child.tagName === "DD",
        ),
      ).toBe(true);
    }
    expect(screen.getByText("No FX conversion")).toBeVisible();
  });
});

function emptyProjection(from: string, to: string) {
  return {
    from,
    to,
    occurrenceCount: 0,
    unknownVariableOccurrenceCount: 0,
    totals: [],
  };
}
