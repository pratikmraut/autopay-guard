import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminGuideDetailScreen } from "@/components/admin-guide-detail-screen";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

const guideId = "00000000-0000-4000-8000-000000000201";
const merchantId = "00000000-0000-4000-8000-000000000202";
const draftId = "00000000-0000-4000-8000-000000000203";

const guide = {
  guideId,
  merchantId,
  merchantName: "Fictional Cloud Demo",
  merchantCategory: "SOFTWARE",
  state: "ACTIVE",
  currentPublishedVersion: 1,
  version: 3,
  updatedAt: "2026-07-28T00:00:00Z",
};

const publishedVersion = {
  guideId,
  guideVersion: 1,
  status: "PUBLISHED",
  riskNotice: "Review the fictional local account before changing anything.",
  structuralReviewedAt: "2026-07-27T00:00:00Z",
  reviewIntervalDays: 60,
  publishedAt: "2026-07-27T01:00:00Z",
  createdAt: "2026-07-27T00:00:00Z",
  draftId: null,
  draftVersion: null,
};

describe("AdminGuideDetailScreen", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    vi.restoreAllMocks();
  });

  it("creates a bodyless server-cloned draft with a stable idempotency key", async () => {
    const user = userEvent.setup();
    const fetchMock = installGuideFetch(async (input, init) => {
      const url = String(input);
      if (
        url === `/api/bff/v1/admin/cancellation-guides/${guideId}/drafts` &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          draftId,
          guideId,
          guideVersion: 2,
          status: "DRAFT",
          riskNotice: publishedVersion.riskNotice,
          structuralReviewedAt: "2026-07-28T00:00:00Z",
          reviewIntervalDays: 60,
          steps: [],
          version: 0,
          createdAt: "2026-07-28T00:00:00Z",
          updatedAt: "2026-07-28T00:00:00Z",
        });
      }
      return undefined;
    });

    render(<AdminGuideDetailScreen guideId={guideId} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Create server-cloned draft",
      }),
    );

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        `/admin/guides/drafts/${draftId}`,
      ),
    );
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/${guideId}/drafts`) && init?.method === "POST",
    );
    const init = createCall?.[1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(new Headers(init?.headers).get("if-match")).toBeNull();
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^guide-draft-create-/,
    );
  });

  it("requires the exact retirement phrase and uses the current head ETag", async () => {
    const user = userEvent.setup();
    const fetchMock = installGuideFetch(async (input, init) => {
      const url = String(input);
      if (
        url === `/api/bff/v1/admin/cancellation-guides/${guideId}/retire` &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          ...guide,
          state: "RETIRED",
          currentPublishedVersion: null,
          version: 4,
          updatedAt: "2026-07-28T02:00:00Z",
        });
      }
      return undefined;
    });

    render(<AdminGuideDetailScreen guideId={guideId} />);
    const confirmation = await screen.findByRole("textbox", {
      name: "Type RETIRE GUIDE",
    });
    const retire = screen.getByRole("button", {
      name: "Retire guide head",
    });
    expect(retire).toBeDisabled();

    await user.type(confirmation, "RETIRE");
    expect(retire).toBeDisabled();
    await user.type(confirmation, " GUIDE");
    expect(retire).toBeEnabled();
    await user.click(retire);

    expect(
      await screen.findByText(
        "The current fictional local guide head was retired. Immutable history was preserved.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Immutable published version")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retire guide head" }),
    ).not.toBeInTheDocument();

    const retireCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/${guideId}/retire`) && init?.method === "POST",
    );
    const init = retireCall?.[1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^guide-head-retire-/,
    );
  });

  it("shows a stale-head recovery control without changing immutable history", async () => {
    const user = userEvent.setup();
    installGuideFetch(async (input, init) => {
      if (
        String(input).endsWith(`/${guideId}/retire`) &&
        init?.method === "POST"
      ) {
        return jsonResponse({ detail: "Stale catalog head." }, 412);
      }
      return undefined;
    });

    render(<AdminGuideDetailScreen guideId={guideId} />);
    await user.type(
      await screen.findByRole("textbox", { name: "Type RETIRE GUIDE" }),
      "RETIRE GUIDE",
    );
    await user.click(screen.getByRole("button", { name: "Retire guide head" }));

    expect(
      await screen.findByText(/This guide changed in another session/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reload latest guide state" }),
    ).toBeVisible();
    expect(screen.getByText("Immutable published version")).toBeVisible();
  });

  it("loads more immutable guide versions and removes the exhausted control", async () => {
    const user = userEvent.setup();
    const olderNotice =
      "Older immutable fictional guidance preserved for review.";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `/api/bff/v1/admin/cancellation-guides/${guideId}`) {
        return jsonResponse(guide);
      }
      if (url === `/api/bff/v1/admin/cancellation-guides/${guideId}/versions`) {
        return jsonResponse({
          items: [publishedVersion],
          nextCursor: "00000000-0000-4000-8000-000000000099",
        });
      }
      if (
        url ===
        `/api/bff/v1/admin/cancellation-guides/${guideId}/versions?cursor=00000000-0000-4000-8000-000000000099&limit=25`
      ) {
        return jsonResponse({
          items: [
            {
              ...publishedVersion,
              guideVersion: 0,
              riskNotice: olderNotice,
              createdAt: "2026-07-26T00:00:00Z",
              publishedAt: "2026-07-26T01:00:00Z",
            },
          ],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<AdminGuideDetailScreen guideId={guideId} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Load more guide versions",
      }),
    );

    expect(screen.getByText(olderNotice)).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Load more guide versions",
      }),
    ).not.toBeInTheDocument();
  });

  it("announces a failed guide-version page and keeps retry available", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `/api/bff/v1/admin/cancellation-guides/${guideId}`) {
        return jsonResponse(guide);
      }
      if (url === `/api/bff/v1/admin/cancellation-guides/${guideId}/versions`) {
        return jsonResponse({
          items: [publishedVersion],
          nextCursor: "00000000-0000-4000-8000-000000000099",
        });
      }
      if (url.includes("/versions?cursor=")) {
        return jsonResponse({ detail: "Page unavailable." }, 503);
      }
      throw new Error(`Unexpected test request: ${url}`);
    });

    render(<AdminGuideDetailScreen guideId={guideId} />);
    const loadMore = await screen.findByRole("button", {
      name: "Load more guide versions",
    });
    await user.click(loadMore);

    expect(
      await screen.findByText("More guide history could not be loaded"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Load more guide versions",
      }),
    ).toBeEnabled();
  });
});

function installGuideFetch(
  mutation: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response | undefined>,
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url === `/api/bff/v1/admin/cancellation-guides/${guideId}` &&
        !init?.method
      ) {
        return jsonResponse(guide);
      }
      if (
        url === `/api/bff/v1/admin/cancellation-guides/${guideId}/versions` &&
        !init?.method
      ) {
        return jsonResponse({ items: [publishedVersion], nextCursor: null });
      }
      const response = await mutation(input, init);
      if (response) {
        return response;
      }
      throw new Error(`Unexpected test request: ${init?.method} ${url}`);
    });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
