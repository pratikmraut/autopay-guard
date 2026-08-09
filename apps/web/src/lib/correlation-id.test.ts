import { describe, expect, it } from "vitest";

import { resolveCorrelationId } from "@/lib/correlation-id";

describe("resolveCorrelationId", () => {
  it("preserves a safe caller identifier", () => {
    expect(resolveCorrelationId("request_01.safe-id", () => "fallback")).toBe(
      "request_01.safe-id",
    );
  });

  it.each([
    null,
    "",
    " leading-space",
    "contains/slash",
    "line\nbreak",
    "a".repeat(65),
  ])("replaces an unsafe caller identifier: %j", (candidate) => {
    expect(resolveCorrelationId(candidate, () => "safe-fallback")).toBe(
      "safe-fallback",
    );
  });
});
