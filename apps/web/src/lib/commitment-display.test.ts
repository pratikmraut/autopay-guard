import { describe, expect, it } from "vitest";

import {
  formatRecurrence,
  upcomingAmountLabel,
} from "@/lib/commitment-display";

describe("commitment presentation", () => {
  it("keeps custom years and month-end behavior explicit", () => {
    expect(
      formatRecurrence({
        frequency: "CUSTOM",
        intervalCount: 2,
        customIntervalUnit: "YEARS",
        monthDayPolicy: "LAST_DAY",
      }),
    ).toBe("Every 2 years, on month end");
    expect(
      formatRecurrence({
        frequency: "HALF_YEARLY",
        intervalCount: 2,
        customIntervalUnit: null,
        monthDayPolicy: "ANCHOR_DAY",
      }),
    ).toBe("Every 2 6-month periods");
  });

  it("never presents an estimate as fixed", () => {
    expect(
      upcomingAmountLabel({
        amountKind: "ESTIMATED",
        expectedAmountMinor: 12345,
        currency: "INR",
      }),
    ).toEqual({ value: "≈ ₹123.45", note: "Estimated variable" });
    expect(
      upcomingAmountLabel({
        amountKind: "UNKNOWN_VARIABLE",
        expectedAmountMinor: null,
        currency: "INR",
      }),
    ).toEqual({ value: "Unknown", note: "Variable amount" });
  });
});
