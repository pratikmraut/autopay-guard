import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Commitment, Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentReminderScreen } from "@/components/commitment-reminder-screen";
import type { ReminderRulesDto } from "@/lib/notification-api";

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
  displayName: "Streaming plan",
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
  maskedPaymentLabel: null,
  source: "MANUAL",
  sourceConfidence: null,
  visibility: "PRIVATE",
  status: "ACTIVE",
  version: 1,
  canManage: true,
  reviewActions: ["KEEP"],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const syntheticRules: ReminderRulesDto = {
  id: null,
  householdId: household.id,
  commitmentId: commitment.id,
  mode: "INHERIT",
  rules: [],
  suggestedRules: [
    {
      channel: "IN_APP",
      offsetDays: 7,
      localSendTime: "09:00",
      enabled: true,
    },
  ],
  version: 0,
  updatedAt: null,
};

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

describe("CommitmentReminderScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a custom override from synthetic version zero", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith(`/v1/commitments/${commitment.id}`)) {
          return jsonResponse(commitment);
        }
        if (init?.method === "PUT") {
          return jsonResponse({
            ...syntheticRules,
            id: "00000000-0000-4000-8000-000000000040",
            mode: "CUSTOM",
            rules: syntheticRules.suggestedRules,
            version: 1,
            updatedAt: "2026-07-26T15:30:00Z",
          });
        }
        return jsonResponse(syntheticRules);
      });

    render(<CommitmentReminderScreen commitmentId={commitment.id} />);

    await user.click(
      await screen.findByRole("radio", { name: /Use custom rules/i }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "7 days · In-app · 09:00",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save reminder rules" }),
    );

    expect(
      await screen.findByText("Commitment reminder rules saved."),
    ).toBeVisible();
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(
          `/v1/commitments/${commitment.id}/reminder-rules`,
        ) && init?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const [, init] = putCall ?? [];
    expect(new Headers(init?.headers).get("if-match")).toBe('"0"');
    expect(JSON.parse(String(init?.body))).toEqual({
      mode: "CUSTOM",
      rules: syntheticRules.suggestedRules,
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
