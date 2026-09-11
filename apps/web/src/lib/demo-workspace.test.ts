import { describe, expect, it } from "vitest";

import {
  archiveDemoCommitment,
  createDemoCommitments,
  demoDueDate,
  demoProjection,
  demoUpcoming,
  validateDemoDraft,
} from "@/lib/demo-workspace";

const draft = {
  name: "Sample subscription",
  amount: "250.25",
  kind: "fixed",
  day: "31",
};

describe("isolated sample workspace domain", () => {
  it("creates independent arrays and records for every new sample", () => {
    const first = createDemoCommitments();
    const second = createDemoCommitments();
    first[0].name = "Changed in first tab";
    first.pop();
    expect(second).toHaveLength(4);
    expect(second[0].name).toBe("StreamBox Demo");
    expect(createDemoCommitments()).toEqual(second);
  });

  it("reconciles seeded monthly and twelve-month fixed/estimated totals", () => {
    expect(demoProjection(createDemoCommitments())).toEqual({
      fixedMinor: 250_000,
      estimatedMinor: 200_000,
      knownMinor: 450_000,
      occurrences: 4,
      activeCount: 4,
    });
    expect(demoProjection(createDemoCommitments(), 12)).toEqual({
      fixedMinor: 3_000_000,
      estimatedMinor: 2_400_000,
      knownMinor: 5_400_000,
      occurrences: 48,
      activeCount: 4,
    });
  });

  it("removes only the archived sample from projections, without mutating input", () => {
    const items = createDemoCommitments();
    const archived = archiveDemoCommitment(items, "sample-cloud");
    expect(demoProjection(archived).knownMinor).toBe(330_000);
    expect(demoProjection(archived, 12).knownMinor).toBe(3_960_000);
    expect(items[1].archived).toBe(false);
    expect(demoUpcoming(archived, "2026-09")).toHaveLength(3);
    expect(archiveDemoCommitment(archived, "sample-cloud")).toEqual(archived);
  });

  it("uses integer paise and preserves estimate classification", () => {
    expect(validateDemoDraft(draft)).toEqual({
      valid: true,
      value: {
        name: "Sample subscription",
        amountMinor: 25_025,
        estimated: false,
        day: 31,
      },
    });
    expect(
      validateDemoDraft({ ...draft, amount: "0.01", kind: "estimated" }),
    ).toMatchObject({
      valid: true,
      value: { amountMinor: 1, estimated: true },
    });
    expect(validateDemoDraft({ ...draft, amount: "1000000" })).toMatchObject({
      valid: true,
    });
  });

  it.each([
    "",
    "0",
    "-1",
    "2.001",
    "1e3",
    "Infinity",
    "NaN",
    "2,000",
    "1.2.3",
    "1000000.01",
    "0001",
    "0x10",
  ])("rejects malformed or out-of-range amount %s", (amount) => {
    expect(validateDemoDraft({ ...draft, amount })).toMatchObject({
      valid: false,
      errors: { amount: expect.any(String) },
    });
  });

  it.each(["", "0", "32", "1.5", "01", "-2", "1e1"])(
    "rejects invalid monthly anchor day %s",
    (day) => {
      expect(validateDemoDraft({ ...draft, day })).toMatchObject({
        valid: false,
        errors: { day: expect.any(String) },
      });
    },
  );

  it.each([
    "a",
    " ",
    "x".repeat(61),
    "https://example.com",
    "person@example.com",
    "www.example.com",
    "Sample 4111 1111 1111 1111",
    "1234",
    "<script>alert(1)</script>",
  ])("rejects unsuitable sample names %s", (name) => {
    expect(validateDemoDraft({ ...draft, name })).toMatchObject({
      valid: false,
      errors: { name: expect.any(String) },
    });
  });

  it("rejects an unexpected amount kind", () => {
    expect(validateDemoDraft({ ...draft, kind: "unknown" })).toMatchObject({
      valid: false,
      errors: { kind: expect.any(String) },
    });
  });

  it("clamps short months without drifting the original anchor", () => {
    expect(demoDueDate("2026-01", 31)).toBe("2026-01-31");
    expect(demoDueDate("2026-02", 31)).toBe("2026-02-28");
    expect(demoDueDate("2026-03", 31)).toBe("2026-03-31");
    expect(demoDueDate("2028-02", 31)).toBe("2028-02-29");
    expect(demoDueDate("2026-04", 31)).toBe("2026-04-30");
  });

  it("sorts selected-month occurrences chronologically and rejects invalid dates", () => {
    expect(
      demoUpcoming(createDemoCommitments(), "2026-09").map(
        (item) => item.dueDate,
      ),
    ).toEqual(["2026-09-05", "2026-09-15", "2026-09-25", "2026-09-30"]);
    expect(() => demoDueDate("2026-13", 5)).toThrow(RangeError);
    expect(() => demoDueDate("2026-01", 0)).toThrow(RangeError);
    expect(() => demoDueDate("1999-01", 5)).toThrow(RangeError);
  });
});
