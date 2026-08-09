import { ApiClientError, type ApiProblem } from "@autopay-guard/contracts";
import { describe, expect, it } from "vitest";

import {
  notificationLoadErrorMessage,
  notificationMutationFailure,
} from "@/lib/notification-api-messages";

describe("notification API messages", () => {
  it("treats an unknown mutation outcome as ambiguous", () => {
    expect(
      notificationMutationFailure(new TypeError("connection lost")),
    ).toEqual({
      conflict: false,
      message:
        "Could not confirm whether it was saved. Reload before retrying to avoid a duplicate action.",
    });
  });

  it("requires a reload after optimistic concurrency failures", () => {
    expect(notificationMutationFailure(clientError(412))).toEqual({
      conflict: true,
      message:
        "This resource changed after you opened it. Reload before saving.",
    });
    expect(notificationMutationFailure(clientError(428)).conflict).toBe(true);
  });

  it("does not distinguish foreign from missing resources", () => {
    expect(notificationLoadErrorMessage(clientError(404))).toBe(
      "This notification resource was not found in your owned workspaces.",
    );
  });
});

function clientError(status: number) {
  const problem: ApiProblem = {
    type: "about:blank",
    title: "Request failed",
    status,
    detail: "Safe detail",
  };
  return new ApiClientError(problem.detail, status, problem, null);
}
