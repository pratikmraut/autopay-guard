import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionInboxScreen } from "@/components/decision-inbox-screen";

const household: Household = {
  id: "00000000-0000-4000-8000-000000000081",
  name: "Demo household",
  ownerUserId: "00000000-0000-4000-8000-000000000082",
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  accessRole: "OWNER",
  canManage: true,
};
const occurrenceId = "00000000-0000-4000-8000-000000000083";
const commitmentId = "00000000-0000-4000-8000-000000000084";
const decisionId = "00000000-0000-4000-8000-000000000085";

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("month=2026-07"),
}));

describe("DecisionInboxScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires explicit confirmation and appends only the selected decision", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          householdId: household.id,
          from: "2026-07-01",
          to: "2026-07-31",
          items: [
            {
              occurrenceId,
              commitmentId,
              householdId: household.id,
              displayName: "Streambox Fictional",
              category: "MEDIA_SUBSCRIPTION",
              paymentRail: "CARD",
              scheduledDate: "2026-07-29",
              expectedAmountMinor: 49900,
              currency: "INR",
              amountKind: "FIXED",
              reviewActions: ["KEEP", "REVIEW", "CANCEL_WITH_PROVIDER"],
              currentDecision: null,
            },
            {
              occurrenceId: "00000000-0000-4000-8000-000000000086",
              commitmentId: "00000000-0000-4000-8000-000000000087",
              householdId: household.id,
              displayName: "Protected utility",
              category: "UTILITY",
              paymentRail: "NACH_ENACH",
              scheduledDate: "2026-07-30",
              expectedAmountMinor: null,
              currency: "INR",
              amountKind: "UNKNOWN_VARIABLE",
              reviewActions: ["KEEP", "REVIEW", "CONFIRM_BILL"],
              currentDecision: null,
            },
          ],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: decisionId,
          occurrenceId,
          commitmentId,
          householdId: household.id,
          decision: "CANCEL_WITH_PROVIDER",
          createdAt: "2026-07-27T09:00:00Z",
        }),
      );

    render(<DecisionInboxScreen />);

    const streambox = (
      await screen.findByRole("heading", { name: "Streambox Fictional" })
    ).closest("article");
    expect(streambox).not.toBeNull();
    const protectedUtility = screen
      .getByRole("heading", { name: "Protected utility" })
      .closest("article");
    expect(protectedUtility).not.toBeNull();
    expect(
      within(protectedUtility!).queryByRole("radio", {
        name: /cancel with provider/i,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(streambox!).getByRole("radio", {
        name: /Plan to cancel with provider/,
      }),
    );
    fireEvent.click(
      within(streambox!).getByRole("button", { name: "Review decision" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/This appends a new decision record/),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(
      await screen.findByText("Decision recorded. Tracking continues."),
    ).toBeVisible();
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe(`/api/bff/v1/occurrences/${occurrenceId}/decisions`);
    expect(init?.method).toBe("POST");
    expect(headers.get("idempotency-key")).toMatch(
      /^decision-[A-Za-z0-9._~-]{16,}$/,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      decision: "CANCEL_WITH_PROVIDER",
    });
    expect(
      screen.getByRole("link", { name: /Review cancellation guide/ }),
    ).toHaveAttribute(
      "href",
      `/commitments/${commitmentId}/cancellation?householdId=${household.id}&occurrenceId=${occurrenceId}&decisionId=${decisionId}`,
    );
  });

  it("rejects a response row from another household", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        householdId: household.id,
        from: "2026-07-01",
        to: "2026-07-31",
        items: [
          {
            occurrenceId,
            commitmentId,
            householdId: "00000000-0000-4000-8000-000000000099",
            displayName: "Leaked row",
            category: "MEDIA_SUBSCRIPTION",
            paymentRail: "CARD",
            scheduledDate: "2026-07-29",
            expectedAmountMinor: 49900,
            currency: "INR",
            amountKind: "FIXED",
            reviewActions: ["KEEP"],
            currentDecision: null,
          },
        ],
        nextCursor: null,
      }),
    );

    render(<DecisionInboxScreen />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Decision inbox unavailable",
      ),
    );
    expect(screen.queryByText("Leaked row")).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
