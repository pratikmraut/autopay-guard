import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CancellationAttemptScreen } from "@/components/cancellation-attempt-screen";
import type { CancellationAttempt } from "@/lib/cancellation-api";

const household: Household = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "Demo household",
  ownerUserId: "00000000-0000-4000-8000-000000000102",
  defaultCurrency: "INR",
  timezone: "Asia/Kolkata",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  accessRole: "OWNER",
  canManage: true,
};
const commitmentId = "00000000-0000-4000-8000-000000000103";
const attemptId = "00000000-0000-4000-8000-000000000104";

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const attempt: CancellationAttempt = {
  id: attemptId,
  householdId: household.id,
  commitmentId,
  occurrenceId: "00000000-0000-4000-8000-000000000107",
  decisionId: "00000000-0000-4000-8000-000000000105",
  guideId: "00000000-0000-4000-8000-000000000106",
  guideVersion: 2,
  guide: {
    id: "00000000-0000-4000-8000-000000000106",
    version: 2,
    householdId: household.id,
    commitmentId,
    merchantName: "Streambox Fictional",
    status: "PUBLISHED",
    freshness: "CURRENT",
    structuralReviewedAt: "2026-07-01T00:00:00Z",
    reviewDueAt: "2026-10-01T00:00:00Z",
    publishedAt: "2026-07-01T00:00:00Z",
    riskNotice: "Fixture only.",
    targetsSuppressed: false,
    targetSuppressionReason: "NONE",
    tracks: [
      {
        track: "SERVICE",
        title: "Cancel the service",
        steps: [],
      },
      {
        track: "PAYMENT_MANDATE",
        title: "Review the payment mandate",
        steps: [],
      },
    ],
  },
  scheduledDate: "2026-07-15",
  amountKind: "FIXED",
  currency: "INR",
  projectedSavingsMinor: 598800,
  savingsPeriodStart: "2026-07-15",
  savingsPeriodEnd: "2027-07-14",
  estimated: false,
  serviceStatus: "CONFIRMED",
  paymentMandateStatus: "CONFIRMED",
  verificationStatus: "SELF_REPORTED",
  verificationDueDate: "2026-07-20",
  verificationDueReached: true,
  completedAt: "2026-07-16T00:00:00Z",
  abandoned: false,
  version: 5,
  createdAt: "2026-07-15T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
};

describe("CancellationAttemptScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves an immutable occurrence snapshot and records honest after-due-date verification", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(attempt))
      .mockResolvedValueOnce(
        jsonResponse({
          ...attempt,
          verificationStatus: "VERIFIED",
          version: 6,
          updatedAt: "2026-07-27T10:00:00Z",
        }),
      );

    render(
      <CancellationAttemptScreen
        attemptId={attemptId}
        commitmentId={commitmentId}
      />,
    );

    expect(
      await screen.findByText(
        "This immutable occurrence and date snapshot is preserved for this attempt.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/AutoPay Guard has no bank feed/)).toBeVisible();
    const verified = screen.getByRole("radio", {
      name: /User-confirmed after the due date/,
    });
    expect(verified.closest("label")).toHaveTextContent(
      "This is not bank, merchant, provider, or independent verification.",
    );

    fireEvent.click(verified);
    fireEvent.click(screen.getByRole("button", { name: "Review outcome" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));

    expect(
      await screen.findByText(
        /Outcome recorded as user-confirmed after the due date/,
      ),
    ).toHaveTextContent("not independently verified");
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe(`/api/bff/v1/cancellation-attempts/${attemptId}/verify`);
    expect(init?.method).toBe("POST");
    expect(headers.get("if-match")).toBe('"5"');
    expect(headers.get("idempotency-key")).toMatch(
      /^verification-[A-Za-z0-9._~-]{16,}$/,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ status: "VERIFIED" });
    expect(screen.getByText(/does not archive this commitment/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Abandon this attempt" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save track progress" }),
    ).not.toBeInTheDocument();
  });

  it("does not infer live-row availability from a saved occurrence ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ...attempt,
        occurrenceId: "00000000-0000-4000-8000-000000000108",
        verificationStatus: "DISPUTED",
      }),
    );

    render(
      <CancellationAttemptScreen
        attemptId={attemptId}
        commitmentId={commitmentId}
      />,
    );

    expect(
      await screen.findByText(
        "This immutable occurrence and date snapshot is preserved for this attempt.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Original occurrence is still available."),
    ).not.toBeInTheDocument();
  });

  it("allows an after-date debit report even when external tracks are incomplete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ...attempt,
        serviceStatus: "NOT_STARTED",
        paymentMandateStatus: "REQUESTED",
        verificationStatus: "PENDING",
        completedAt: null,
      }),
    );

    render(
      <CancellationAttemptScreen
        attemptId={attemptId}
        commitmentId={commitmentId}
      />,
    );

    expect(
      await screen.findByText(/You can still report an observed debit/),
    ).toBeVisible();
    expect(
      screen.getByRole("radio", {
        name: /Debit reported after the due date/,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("radio", {
        name: /External steps self-reported/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radio", {
        name: /User-confirmed after the due date/,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the future follow-up date and reload action before the server boundary", async () => {
    const beforeBoundaryAttempt = {
      ...attempt,
      verificationDueDate: "2099-01-02",
      verificationDueReached: false,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(beforeBoundaryAttempt)),
      );

    render(
      <CancellationAttemptScreen
        attemptId={attemptId}
        commitmentId={commitmentId}
      />,
    );

    expect(
      await screen.findByText(
        /Further user-attested follow-up becomes available/,
      ),
    ).toHaveTextContent("not yet user-confirmed after the due date");
    expect(
      screen.getByText("After-date eligibility comes from the server"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload after-date eligibility" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("No further verification transition is available."),
    ).not.toBeInTheDocument();
  });

  it("does not use the browser clock to unlock after-date outcomes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ...attempt,
        verificationDueDate: "2000-01-02",
        verificationDueReached: false,
      }),
    );

    render(
      <CancellationAttemptScreen
        attemptId={attemptId}
        commitmentId={commitmentId}
      />,
    );

    expect(
      await screen.findByText("After-date eligibility comes from the server"),
    ).toBeVisible();
    expect(
      screen.queryByRole("radio", {
        name: /User-confirmed after the due date/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radio", {
        name: /Debit reported after the due date/,
      }),
    ).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
