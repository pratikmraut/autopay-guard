import { describe, expect, it } from "vitest";

import { categoryCanPauseTracking } from "@/lib/commitment-options";

describe("category-safe tracking controls", () => {
  it.each(["EMI_LOAN", "INSURANCE", "INVESTMENT_COMMITMENT"] as const)(
    "does not offer pause for protected category %s",
    (category) => {
      expect(categoryCanPauseTracking(category)).toBe(false);
    },
  );

  it.each(["SUBSCRIPTION", "MEMBERSHIP", "SOFTWARE"] as const)(
    "allows a presentation-only pause control for %s",
    (category) => {
      expect(categoryCanPauseTracking(category)).toBe(true);
    },
  );
});
