import { ApiClientError } from "@autopay-guard/contracts";
import { describe, expect, it } from "vitest";

import {
  archiveCommitmentErrorMessage,
  saveCommitmentErrorMessage,
} from "@/lib/commitment-api-messages";

describe("archive commitment concurrency messages", () => {
  it("requires a reload for stale and missing preconditions", () => {
    expect(
      archiveCommitmentErrorMessage(
        new ApiClientError("stale", 412, null, null),
      ),
    ).toBe(
      "This commitment changed after you opened it. Reload before archiving.",
    );
    expect(
      archiveCommitmentErrorMessage(
        new ApiClientError("required", 428, null, null),
      ),
    ).toBe("A current version is required. Reload before archiving.");
  });

  it("does not claim an archive failed when the response is ambiguous", () => {
    expect(archiveCommitmentErrorMessage(new TypeError("network lost"))).toBe(
      "Could not confirm whether it was archived. Reload before retrying.",
    );
  });
});

describe("save commitment failure messages", () => {
  it("does not claim a create or update failed when the response is ambiguous", () => {
    expect(saveCommitmentErrorMessage(new TypeError("network lost"))).toBe(
      "Could not confirm whether it was saved. Check the list or reload before retrying.",
    );
  });
});
