import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Commitment, Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentForm } from "@/components/commitment-form";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const household: Household = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Demo household",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  accessRole: "OWNER",
  canManage: true,
};

const commitment: Commitment = {
  id: "00000000-0000-4000-8000-000000000020",
  householdId: household.id,
  dataOwnerUserId: household.ownerUserId,
  responsibleMemberId: null,
  merchantId: null,
  merchantCanonicalName: null,
  displayName: "StreamBox Demo",
  category: "SUBSCRIPTION",
  paymentRail: "CARD_RECURRING",
  amountMinor: 49900,
  estimatedAmountMinor: null,
  currency: "INR",
  frequency: "MONTHLY",
  intervalCount: 1,
  customIntervalUnit: null,
  anchorDate: "2026-07-15",
  monthDayPolicy: "ANCHOR_DAY",
  nextDueDate: "2026-08-15",
  variableAmount: false,
  maskedPaymentLabel: "Card ending 42",
  source: "MANUAL",
  sourceConfidence: null,
  visibility: "PRIVATE",
  status: "ACTIVE",
  version: 7,
  canManage: true,
  reviewActions: [
    "KEEP",
    "REVIEW",
    "PAUSE_TRACKING",
    "CANCEL_WITH_PROVIDER",
    "DOWNGRADE_WITH_PROVIDER",
    "SWITCH_PROVIDER",
  ],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("CommitmentForm", () => {
  beforeEach(() => {
    routerMocks.push.mockReset();
    routerMocks.refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("sends an exact version and surfaces a stale update without overwriting", async () => {
    const user = userEvent.setup();
    const reloadLatest = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Precondition Failed",
          status: 412,
          detail: "The version is stale.",
        }),
        {
          status: 412,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );
    render(
      <CommitmentForm
        household={household}
        initial={commitment}
        onReloadLatest={reloadLatest}
      />,
    );

    expect(screen.getByLabelText(/^Display name/)).toHaveValue(
      "StreamBox Demo",
    );
    expect(screen.getByLabelText(/^Fixed amount/)).toHaveValue("499.00");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("A newer version exists")).toBeVisible();
    expect(
      screen.getByText(
        "This commitment changed after you opened it. Reload the latest version before saving again.",
      ),
    ).toBeVisible();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/bff/v1/commitments/${commitment.id}`);
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("if-match")).toBe('"7"');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.status).toBe("ACTIVE");
    expect(body).not.toHaveProperty("ownerUserId");
    expect(body).not.toHaveProperty("source");
    expect(body).not.toHaveProperty("sourceConfidence");
    expect(body).not.toHaveProperty("visibility");
    expect(routerMocks.push).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Reload latest version" }),
    );
    expect(reloadLatest).toHaveBeenCalledOnce();
  });

  it("does not offer pause for a protected category", async () => {
    render(
      <CommitmentForm
        household={household}
        initial={{
          ...commitment,
          category: "EMI_LOAN",
          reviewActions: [
            "REVIEW",
            "DUE_DATE_READINESS",
            "PAYMENT_CONFIRMATION",
          ],
        }}
      />,
    );

    const status = screen.getByLabelText(/^Tracking status/);
    await waitFor(() => expect(status).toHaveValue("ACTIVE"));
    expect(
      within(status).queryByRole("option", { name: "Paused" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Pause is not offered for this category. This avoids implying that an essential or protected payment should be stopped.",
      ),
    ).toBeVisible();
  });

  it("creates a merchant-less commitment without server-owned fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ...commitment,
          id: "00000000-0000-4000-8000-000000000030",
          displayName: "Retry Demo",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    render(<CommitmentForm household={household} />);
    await user.type(screen.getByLabelText(/^Display name/), "Retry Demo");
    await user.type(screen.getByLabelText(/^Fixed amount/), "499.00");

    const submit = screen.getByRole("button", {
      name: "Add recurring commitment",
    });
    await user.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body.householdId).toBe(household.id);
    expect(body.merchantId).toBeNull();
    expect(body.amountMinor).toBe(49900);
    expect(body.estimatedAmountMinor).toBeNull();
    expect(body).not.toHaveProperty("source");
    expect(body).not.toHaveProperty("visibility");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("idempotency-key"),
    ).toBe(false);
    expect(routerMocks.push).toHaveBeenCalledWith(
      "/commitments/00000000-0000-4000-8000-000000000030?householdId=00000000-0000-4000-8000-000000000010&saved=1",
    );
  });

  it("distinguishes a merchant search failure from a valid empty result", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("catalog unavailable"),
    );
    render(<CommitmentForm household={household} />);

    await user.type(
      screen.getByLabelText("Find a known merchant (optional)"),
      "Stream",
    );

    expect(
      await screen.findByText(
        "Catalog search unavailable; enter manually or retry.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("No catalog match. You can still enter it manually."),
    ).not.toBeInTheDocument();
  });

  it("preserves an existing commitment currency and its fraction digits", async () => {
    const user = userEvent.setup();
    const kwdCommitment = {
      ...commitment,
      currency: "KWD",
      amountMinor: 1_234,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(kwdCommitment), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<CommitmentForm household={household} initial={kwdCommitment} />);

    expect(screen.getByLabelText(/^Fixed amount \(KWD\)/)).toHaveValue("1.234");
    expect(screen.getByText("Preserved from this commitment")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body.currency).toBe("KWD");
    expect(body.amountMinor).toBe(1_234);
  });

  it("does not claim an unknown submission failure was not committed", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("response lost"),
    );
    render(<CommitmentForm household={household} />);
    await user.type(screen.getByLabelText(/^Display name/), "Ambiguous save");
    await user.type(screen.getByLabelText(/^Fixed amount/), "499.00");
    await user.click(
      screen.getByRole("button", { name: "Add recurring commitment" }),
    );

    expect(
      await screen.findByText(
        "Could not confirm whether it was saved. Check the list or reload before retrying.",
      ),
    ).toBeVisible();
  });
});
