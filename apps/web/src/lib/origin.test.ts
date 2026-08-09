import { describe, expect, it } from "vitest";

import { isExpectedRequestOrigin } from "@/lib/origin";

describe("isExpectedRequestOrigin", () => {
  const configuredUrl = "https://guard.example.test";

  it("accepts only the configured public origin", () => {
    expect(
      isExpectedRequestOrigin("https://guard.example.test", configuredUrl),
    ).toBe(true);
    expect(
      isExpectedRequestOrigin("https://guard.example.test:444", configuredUrl),
    ).toBe(false);
    expect(
      isExpectedRequestOrigin("https://attacker.example", configuredUrl),
    ).toBe(false);
  });

  it("rejects missing and malformed origins", () => {
    expect(isExpectedRequestOrigin(null, configuredUrl)).toBe(false);
    expect(isExpectedRequestOrigin("not a URL", configuredUrl)).toBe(false);
  });
});
