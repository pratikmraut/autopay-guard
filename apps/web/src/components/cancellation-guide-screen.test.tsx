import { render, screen, within } from "@testing-library/react";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CancellationGuideScreen,
  GuideTracks,
} from "@/components/cancellation-guide-screen";
import type { CancellationGuide } from "@/lib/cancellation-api";

const scopeMocks = vi.hoisted(() => ({
  household: {
    id: "00000000-0000-4000-8000-000000000072",
    name: "Demo household",
    ownerUserId: "00000000-0000-4000-8000-000000000074",
    defaultCurrency: "INR",
    timezone: "Asia/Kolkata",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  } as Household,
}));

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => scopeMocks.household,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const guide: CancellationGuide = {
  id: "00000000-0000-4000-8000-000000000071",
  version: 4,
  householdId: "00000000-0000-4000-8000-000000000072",
  commitmentId: "00000000-0000-4000-8000-000000000073",
  merchantName: "Streambox Fictional",
  status: "PUBLISHED",
  freshness: "CURRENT",
  structuralReviewedAt: "2026-07-01T00:00:00Z",
  reviewDueAt: "2026-10-01T00:00:00Z",
  publishedAt: "2026-07-01T00:00:00Z",
  riskNotice: "Confirm the fictional merchant name before continuing.",
  targetsSuppressed: false,
  targetSuppressionReason: "NONE",
  tracks: [
    {
      track: "SERVICE",
      title: "Cancel the merchant service",
      steps: [
        {
          sequence: 2,
          kind: "SAFE_LINK",
          title: "Open the fictional account page",
          instruction: "Use the fixture target.",
          target: {
            label: "Open fictional service settings",
            uri: "https://support.streambox.example/manage/subscription",
          },
        },
        {
          sequence: 1,
          kind: "INFORMATION",
          title: "Check your saved details",
          instruction: "Review the commitment snapshot first.",
          target: null,
        },
      ],
    },
    {
      track: "PAYMENT_MANDATE",
      title: "Review the separate mandate",
      steps: [
        {
          sequence: 1,
          kind: "APP_DEEP_LINK",
          title: "Open the fictional mandate app",
          instruction: "This does not cancel the merchant service.",
          target: {
            label: "Open fictional mandate",
            uri: "autopayguard-demo://mandates/service/manage",
          },
        },
      ],
    },
  ],
};

describe("GuideTracks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders two independent ordered tracks and only canonical fixture links", () => {
    render(<GuideTracks guide={guide} />);

    const service = screen
      .getByRole("heading", { name: "Cancel the merchant service" })
      .closest("section");
    const mandate = screen
      .getByRole("heading", { name: "Review the separate mandate" })
      .closest("section");
    expect(service).not.toBeNull();
    expect(mandate).not.toBeNull();
    expect(within(service!).getByText("Track 1")).toBeVisible();
    expect(within(mandate!).getByText("Track 2")).toBeVisible();

    const serviceSteps = within(service!).getAllByRole("listitem");
    expect(
      within(serviceSteps[0]!).getByText("Check your saved details"),
    ).toBeVisible();
    expect(
      within(serviceSteps[1]!).getByText("Open the fictional account page"),
    ).toBeVisible();

    const webTarget = within(service!).getByRole("link", {
      name: /Open fictional service settings/,
    });
    expect(webTarget).toHaveAttribute(
      "href",
      "https://support.streambox.example/manage/subscription",
    );
    expect(webTarget).toHaveAttribute("target", "_blank");
    expect(webTarget).toHaveAttribute("rel", "noopener noreferrer");

    const demoTarget = within(mandate!).getByRole("link", {
      name: /Open fictional mandate/,
    });
    expect(demoTarget).toHaveAttribute(
      "href",
      "autopayguard-demo://mandates/service/manage",
    );
    expect(demoTarget).not.toHaveAttribute("target");
  });

  it("withholds a non-canonical target in the browser", () => {
    const unsafeGuide: CancellationGuide = {
      ...guide,
      tracks: guide.tracks.map((track) =>
        track.track === "SERVICE"
          ? {
              ...track,
              steps: track.steps.map((step) =>
                step.kind === "SAFE_LINK"
                  ? {
                      ...step,
                      target: {
                        label: "Unsafe",
                        uri: "https://support.streambox.example.evil.test/manage/subscription",
                      },
                    }
                  : step,
              ),
            }
          : track,
      ),
    };

    render(<GuideTracks guide={unsafeGuide} />);

    expect(
      screen.getByText("Unsafe target withheld by this browser"),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Unsafe/ }),
    ).not.toBeInTheDocument();
  });

  it("withholds every target when the server suppresses the guide", () => {
    render(
      <GuideTracks
        guide={{
          ...guide,
          targetsSuppressed: true,
          targetSuppressionReason: "USER_REPORTED_UNSAFE",
        }}
      />,
    );

    expect(screen.getAllByText("External demo target withheld")).toHaveLength(
      2,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("treats a user-confirmed attempt as resolved and permits a new record", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/cancellation-guide")) {
        return jsonResponse(guide);
      }
      if (url.includes("/cancellation-attempts?")) {
        return jsonResponse({
          householdId: guide.householdId,
          commitmentId: guide.commitmentId,
          items: [
            {
              id: "00000000-0000-4000-8000-000000000075",
              householdId: guide.householdId,
              commitmentId: guide.commitmentId,
              guideVersion: guide.version,
              verificationStatus: "VERIFIED",
              abandoned: false,
              createdAt: "2026-07-20T00:00:00Z",
              scheduledDate: "2026-07-19",
            },
          ],
          nextCursor: null,
        });
      }
      if (url.endsWith(`/v1/commitments/${guide.commitmentId}`)) {
        return jsonResponse({
          id: guide.commitmentId,
          householdId: guide.householdId,
          displayName: "Streambox Fictional",
          status: "ACTIVE",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<CancellationGuideScreen commitmentId={guide.commitmentId} />);

    expect(
      await screen.findByRole("heading", {
        name: "Start a cancellation attempt",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Resume attempt/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Record a cancel decision first")).toBeVisible();
    expect(screen.getByText(/User-confirmed after due date/)).toBeVisible();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
