import { describe, expect, it } from "vitest";

import {
  currencyAmountPlaceholder,
  currencyFractionDigits,
  currencyInputPrefix,
  formatMinorMoney,
  minorToMajorInput,
  parseMajorToMinor,
} from "@/lib/money";

describe("money helpers", () => {
  it.each([
    ["0", 0],
    ["0.1", 10],
    ["0.01", 1],
    ["1499", 149_900],
    ["9999999999.99", 999_999_999_999],
  ])("parses %s exactly to integer INR minor units", (major, minor) => {
    expect(parseMajorToMinor(major, "INR")).toBe(minor);
  });

  it.each(["1.001", "-2", "01", "1,000", "10000000000", "hello"])(
    "rejects unsafe or ambiguous amount %s",
    (amount) => {
      expect(parseMajorToMinor(amount, "INR")).toBeNull();
    },
  );

  it("uses ISO currency fraction digits without floating point conversion", () => {
    expect(currencyFractionDigits("USD")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KWD")).toBe(3);
    expect(parseMajorToMinor("12.34", "USD")).toBe(1_234);
    expect(parseMajorToMinor("1234", "JPY")).toBe(1_234);
    expect(parseMajorToMinor("1.234", "JPY")).toBeNull();
    expect(parseMajorToMinor("12.345", "KWD")).toBe(12_345);
    expect(parseMajorToMinor("12.3456", "KWD")).toBeNull();
    expect(minorToMajorInput(12_345, "KWD")).toBe("12.345");
    expect(minorToMajorInput(1_234, "JPY")).toBe("1234");
  });

  it("formats integer minor units using currency-aware precision", () => {
    expect(formatMinorMoney(123_456_78)).toBe("₹1,23,456.78");
    expect(formatMinorMoney(500_00)).toBe("₹500");
    expect(formatMinorMoney(123_456, "JPY")).toBe("JPY 1,23,456");
    expect(formatMinorMoney(12_345, "KWD")).toBe("KWD 12.345");
    expect(minorToMajorInput(19_999, "INR")).toBe("199.99");
    expect(currencyInputPrefix("INR")).toBe("₹");
    expect(currencyInputPrefix("USD")).toBe("USD");
    expect(currencyAmountPlaceholder("JPY")).toBe("499");
    expect(currencyAmountPlaceholder("KWD")).toBe("499.000");
  });
});
