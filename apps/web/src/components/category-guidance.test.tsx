import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CategoryGuidance } from "@/components/category-guidance";

describe("CategoryGuidance", () => {
  it("keeps EMI guidance readiness-only and omits cancellation actions", () => {
    render(
      <CategoryGuidance
        category="EMI_LOAN"
        reviewActions={["REVIEW", "DUE_DATE_READINESS", "PAYMENT_CONFIRMATION"]}
      />,
    );

    expect(screen.getByText("Due-date readiness only")).toBeVisible();
    expect(screen.getByText("Check due-date readiness")).toBeVisible();
    expect(screen.queryByText("Cancel with provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Pause tracking")).not.toBeInTheDocument();
  });

  it("does not frame insurance or investment commitments as cancellable", () => {
    const { rerender } = render(
      <CategoryGuidance
        category="INSURANCE"
        reviewActions={["KEEP", "REVIEW", "RENEWAL_READINESS"]}
      />,
    );
    expect(screen.getByText("Review coverage carefully")).toBeVisible();
    expect(screen.queryByText("Cancel with provider")).not.toBeInTheDocument();

    rerender(
      <CategoryGuidance
        category="INVESTMENT_COMMITMENT"
        reviewActions={["KEEP", "REVIEW", "TRACK"]}
      />,
    );
    expect(screen.getByText("Tracking, not advice")).toBeVisible();
    expect(screen.queryByText("Pause tracking")).not.toBeInTheDocument();
  });
});
