import { ApiClientError } from "@autopay-guard/contracts";
import { describe, expect, it } from "vitest";

import {
  cancellationLoadErrorMessage,
  cancellationMutationFailure,
} from "@/lib/cancellation-api-messages";

describe("cancellation API messages", () => {
  it("keeps owned not-found reads deliberately indistinguishable", () => {
    expect(
      cancellationLoadErrorMessage(
        new ApiClientError("Not found", 404, null, "correlation"),
      ),
    ).toBe(
      "This cancellation resource was not found in your owned workspaces.",
    );
  });

  it("requires a reload after a stale conditional mutation", () => {
    expect(
      cancellationMutationFailure(
        new ApiClientError("Stale", 412, null, "correlation"),
      ),
    ).toEqual({
      conflict: true,
      uncertain: false,
      message:
        "This record changed after you opened it. Reload the latest version before saving.",
    });
  });

  it("distinguishes replay-protected actions from conditional PATCH uncertainty", () => {
    expect(
      cancellationMutationFailure(new TypeError("network"), {
        replayProtected: true,
      }).message,
    ).toContain("reuses its idempotency key");
    expect(cancellationMutationFailure(new TypeError("network")).message).toBe(
      "AutoPay Guard could not confirm whether the update was recorded. Reload the latest version before deciding whether to retry.",
    );
  });
});
