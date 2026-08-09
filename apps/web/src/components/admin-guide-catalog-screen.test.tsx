import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminGuideCatalogScreen } from "@/components/admin-guide-catalog-screen";

const guideId = "00000000-0000-4000-8000-000000000101";
const merchantId = "00000000-0000-4000-8000-000000000102";
const feedbackId = "00000000-0000-4000-8000-000000000103";

const guide = {
  guideId,
  merchantId,
  merchantName: "Fictional Stream Demo",
  merchantCategory: "SUBSCRIPTION",
  state: "ACTIVE",
  currentPublishedVersion: 1,
  version: 3,
  updatedAt: "2026-07-28T00:00:00Z",
};

const feedback = {
  id: feedbackId,
  guideId,
  guideVersion: 1,
  outcome: "OUTDATED",
  createdAt: "2026-07-28T01:00:00Z",
  disposition: "PENDING",
  version: 0,
};

describe("AdminGuideCatalogScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders only the allowlisted redacted feedback fields", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/bff/v1/admin/cancellation-guides") {
        return jsonResponse({ items: [guide] });
      }
      if (url === "/api/bff/v1/admin/cancellation-guide-feedback?limit=50") {
        return jsonResponse({
          items: [
            {
              ...feedback,
              note: "PRIVATE NOTE CANARY",
              userEmail: "private-user@example.test",
              householdName: "PRIVATE HOUSEHOLD CANARY",
              commitmentTitle: "PRIVATE COMMITMENT CANARY",
              amountMinor: 987654,
              targetUri: "https://secret-target.example",
            },
          ],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<AdminGuideCatalogScreen />);

    expect(
      await screen.findByRole("heading", {
        name: "Fictional guide administration",
      }),
    ).toBeVisible();
    expect(screen.getByText("Fictional Stream Demo")).toBeVisible();
    expect(screen.getByText(`Feedback ${feedbackId}`)).toBeVisible();
    expect(screen.getByText(new RegExp(guideId))).toBeVisible();
    expect(screen.getByText("PENDING")).toBeVisible();

    expect(screen.queryByText(/PRIVATE NOTE CANARY/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/private-user@example\.test/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/PRIVATE HOUSEHOLD CANARY/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/PRIVATE COMMITMENT CANARY/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/987654/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/secret-target\.example/),
    ).not.toBeInTheDocument();
  });

  it("requires explicit review confirmation and reuses the idempotency key on retry", async () => {
    const user = userEvent.setup();
    const reviewKeys: string[] = [];
    let reviewAttempts = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "/api/bff/v1/admin/cancellation-guides") {
          return jsonResponse({ items: [guide] });
        }
        if (url === "/api/bff/v1/admin/cancellation-guide-feedback?limit=50") {
          return jsonResponse({
            items: [feedback],
            nextCursor: null,
          });
        }
        if (
          url ===
            `/api/bff/v1/admin/cancellation-guide-feedback/${feedbackId}/review` &&
          init?.method === "POST"
        ) {
          reviewAttempts += 1;
          reviewKeys.push(
            new Headers(init.headers).get("idempotency-key") ?? "",
          );
          if (reviewAttempts === 1) {
            return jsonResponse({ detail: "Temporary local failure." }, 500);
          }
          return jsonResponse({
            ...feedback,
            disposition: "RESOLVED",
            version: 1,
          });
        }
        throw new Error(`Unexpected test request: ${init?.method} ${url}`);
      });

    render(<AdminGuideCatalogScreen />);
    const save = await screen.findByRole("button", {
      name: "Save feedback review",
    });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Mark resolved" }));
    expect(save).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm this changes only the redacted feedback review/i,
      }),
    );
    expect(save).toBeEnabled();

    await user.click(save);
    expect(await screen.findByText("Temporary local failure.")).toBeVisible();
    await user.click(save);

    expect(
      await screen.findByText("Feedback review saved as resolved."),
    ).toBeVisible();
    expect(screen.getByText("RESOLVED")).toBeVisible();
    expect(reviewKeys).toHaveLength(2);
    expect(reviewKeys[0]).toMatch(/^guide-feedback-review-/);
    expect(reviewKeys[1]).toBe(reviewKeys[0]);

    const reviewCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/${feedbackId}/review`),
    );
    const finalInit = reviewCalls.at(-1)?.[1];
    expect(new Headers(finalInit?.headers).get("if-match")).toBe('"0"');
    expect(JSON.parse(String(finalInit?.body))).toEqual({
      disposition: "RESOLVED",
    });
  });

  it("keeps existing rows visible when loading another feedback page fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/bff/v1/admin/cancellation-guides") {
        return jsonResponse({ items: [guide] });
      }
      if (url === "/api/bff/v1/admin/cancellation-guide-feedback?limit=50") {
        return jsonResponse({
          items: [feedback],
          nextCursor: "00000000-0000-4000-8000-000000000104",
        });
      }
      if (url.includes("cursor=")) {
        return jsonResponse({ detail: "Pagination unavailable." }, 503);
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<AdminGuideCatalogScreen />);
    await user.click(
      await screen.findByRole("button", {
        name: "Load more redacted feedback",
      }),
    );

    expect(await screen.findByText("Pagination unavailable.")).toBeVisible();
    expect(screen.getByText(`Feedback ${feedbackId}`)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Load more redacted feedback",
        }),
      ).toBeEnabled(),
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
