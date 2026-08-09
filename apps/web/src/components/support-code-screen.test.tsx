import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupportCodeScreen } from "@/components/support-code-screen";

const household = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Fake household",
  ownerUserId: "10000000-0000-4000-8000-000000000002",
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
  accessRole: "OWNER" as const,
  canManage: true,
};

const grant = {
  id: "10000000-0000-4000-8000-000000000003",
  status: "ACTIVE" as const,
  version: 0,
  expiresAt: "2026-07-27T00:15:00Z",
  createdAt: "2026-07-27T00:00:00Z",
};
const supportCode = "s".repeat(43);

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

describe("SupportCodeScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("focuses the one-time result, reports clipboard failure, and restores focus after revoke", async () => {
    const user = userEvent.setup();
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("no")) };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ grant, supportCode }, 201);
      }
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request method ${init?.method}`);
    });

    render(<SupportCodeScreen />);
    await user.click(
      screen.getByRole("checkbox", {
        name: /authorize temporary read-only redacted diagnostics/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Generate one-time support code" }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Support code created locally",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(heading.closest("section")),
    );
    expect(screen.getByText(supportCode, { selector: "output" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(
      await screen.findByText(/Clipboard access was unavailable/i),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Revoke now" }));
    const revoked = await screen.findByText("Support code revoked.");
    expect(revoked).toBeVisible();
    await waitFor(() =>
      expect(revoked.closest('[role="status"]')).toHaveFocus(),
    );
  });

  it("announces a successful clipboard copy", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ grant, supportCode }, 201),
    );

    render(<SupportCodeScreen />);
    await user.click(
      screen.getByRole("checkbox", {
        name: /authorize temporary read-only redacted diagnostics/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Generate one-time support code" }),
    );
    await user.click(await screen.findByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith(supportCode);
    expect(await screen.findByText("Support code copied.")).toBeVisible();
  });
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
