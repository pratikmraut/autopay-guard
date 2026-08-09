import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrivacyControlScreen } from "@/components/privacy-control-screen";

const acknowledgementCursor = "00000000-0000-4000-8000-000000000091";
const consentCursor = "00000000-0000-4000-8000-000000000092";
const digest = "a".repeat(64);

describe("PrivacyControlScreen pagination", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads more append-only notice and consent history without duplicates", async () => {
    const user = userEvent.setup();
    installPrivacyFetch();

    render(<PrivacyControlScreen />);

    await user.click(
      await screen.findByRole("button", {
        name: "Load more notice history",
      }),
    );
    expect(screen.getByText(/notice-v0 ·/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load more notice history" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Load more consent history",
      }),
    );
    expect(screen.getByText(/Withdrawn · foundation-v1 ·/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load more consent history" }),
    ).not.toBeInTheDocument();
  });

  it("announces a failed history page and leaves its retry control available", async () => {
    const user = userEvent.setup();
    installPrivacyFetch({ failNoticePage: true });

    render(<PrivacyControlScreen />);
    const loadMore = await screen.findByRole("button", {
      name: "Load more notice history",
    });
    await user.click(loadMore);

    expect(
      await screen.findByText("That operation was not completed"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load more notice history" }),
    ).toBeEnabled();
  });
});

function installPrivacyFetch({
  failNoticePage = false,
}: {
  failNoticePage?: boolean;
} = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "https://autopay-guard.test");
    const cursor = url.searchParams.get("cursor");
    if (url.pathname === "/api/bff/v1/privacy/notices/current") {
      return Response.json({
        noticeVersion: "foundation-v1",
        contentSha256: digest,
        acknowledgementType: "ACKNOWLEDGED",
      });
    }
    if (url.pathname === "/api/bff/v1/privacy/notice-acknowledgements") {
      if (cursor) {
        return failNoticePage
          ? new Response(null, { status: 503 })
          : Response.json({
              items: [
                {
                  id: "00000000-0000-4000-8000-000000000012",
                  noticeVersion: "notice-v0",
                  contentSha256: digest,
                  eventType: "ACKNOWLEDGED",
                  acknowledgedAt: "2026-07-27T00:00:00Z",
                },
              ],
              nextCursor: null,
            });
      }
      return Response.json({
        items: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            noticeVersion: "foundation-v1",
            contentSha256: digest,
            eventType: "ACKNOWLEDGED",
            acknowledgedAt: "2026-07-28T00:00:00Z",
          },
        ],
        nextCursor: acknowledgementCursor,
      });
    }
    if (url.pathname === "/api/bff/v1/privacy/consents") {
      return cursor
        ? Response.json({
            purpose: "HOUSEHOLD_SHARING",
            currentPurposeVersion: "foundation-v1",
            currentAction: "GRANTED",
            events: [
              {
                id: "00000000-0000-4000-8000-000000000022",
                purpose: "HOUSEHOLD_SHARING",
                purposeVersion: "foundation-v1",
                action: "WITHDRAWN",
                occurredAt: "2026-07-27T00:00:00Z",
              },
            ],
            nextCursor: null,
          })
        : Response.json({
            purpose: "HOUSEHOLD_SHARING",
            currentPurposeVersion: "foundation-v1",
            currentAction: "GRANTED",
            events: [
              {
                id: "00000000-0000-4000-8000-000000000021",
                purpose: "HOUSEHOLD_SHARING",
                purposeVersion: "foundation-v1",
                action: "GRANTED",
                occurredAt: "2026-07-28T00:00:00Z",
              },
            ],
            nextCursor: consentCursor,
          });
    }
    if (url.pathname === "/api/bff/v1/privacy/requests") {
      return Response.json({ items: [], nextCursor: null });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
}
