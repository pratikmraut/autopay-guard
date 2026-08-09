import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupportDiagnosticsScreen } from "@/components/support-diagnostics-screen";

const supportCode = "d".repeat(43);

describe("SupportDiagnosticsScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("announces and focuses bounded redacted diagnostics", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          schemaVersion: "support-diagnostics-v1",
          status: "HEALTHY",
          activeCommitmentCount: 4,
          failedNotificationCount: 0,
          pendingPrivacyRequestCount: 1,
          latestCommitmentVersion: 7,
          generatedAt: "2026-07-27T00:00:00Z",
          grantExpiresAt: "2026-07-27T00:15:00Z",
        },
        200,
      ),
    );

    render(<SupportDiagnosticsScreen />);
    await user.type(
      screen.getByRole("textbox", { name: "Owner-provided support code" }),
      supportCode,
    );
    await user.click(
      screen.getByRole("button", { name: "Open redacted diagnostics" }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Bounded workspace state",
    });
    expect(
      screen.getByText("Redacted read-only diagnostics loaded."),
    ).toHaveAttribute("role", "status");
    await waitFor(() =>
      expect(document.activeElement).toBe(heading.closest("section")),
    );
    expect(screen.getByText("HEALTHY")).toBeVisible();
  });

  it("focuses the safe error without exposing upstream detail", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          title: "Not found",
          detail: "SECRET_INTERNAL_CODE_DIGEST",
        },
        404,
      ),
    );

    render(<SupportDiagnosticsScreen />);
    await user.type(
      screen.getByRole("textbox", { name: "Owner-provided support code" }),
      supportCode,
    );
    await user.click(
      screen.getByRole("button", { name: "Open redacted diagnostics" }),
    );

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "The role/code pair is invalid, revoked, expired, or unavailable.",
    );
    expect(error).not.toHaveTextContent("SECRET_INTERNAL_CODE_DIGEST");
    await waitFor(() => expect(error).toHaveFocus());
  });
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
