import { describe, expect, it, vi } from "vitest";

import { createIdempotencyKey } from "@/lib/idempotency-key";

describe("createIdempotencyKey", () => {
  it("creates a conservative, bounded key", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000123",
    );
    expect(createIdempotencyKey("M4 attempt")).toBe(
      "m4-attempt-00000000-0000-4000-8000-000000000123",
    );
  });

  it("rejects an empty normalized scope", () => {
    expect(() => createIdempotencyKey("***")).toThrow(
      "An idempotency-key scope is required.",
    );
  });
});
