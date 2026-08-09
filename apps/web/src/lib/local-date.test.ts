import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  addLocalMonths,
  calendarWeeks,
  monthRange,
  todayInTimeZone,
} from "@/lib/local-date";

describe("local-date presentation helpers", () => {
  it("handles leap-day and month boundaries deterministically", () => {
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addLocalDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(monthRange("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("moves between calendar months without day drift", () => {
    expect(addLocalMonths("2026-12", 1)).toBe("2027-01");
    expect(addLocalMonths("2026-01", -1)).toBe("2025-12");
  });

  it("builds complete Monday-first calendar weeks", () => {
    const weeks = calendarWeeks("2026-07");
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("derives today from the selected household timezone", () => {
    const instant = new Date("2026-07-26T20:15:00.000Z");
    expect(todayInTimeZone("Asia/Kolkata", instant)).toBe("2026-07-27");
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2026-07-26");
  });
});
