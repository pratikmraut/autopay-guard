import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingForm } from "@/components/onboarding-form";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

describe("OnboardingForm", () => {
  beforeEach(() => {
    routerMocks.push.mockReset();
    routerMocks.refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("requires the age and privacy confirmations", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm defaultName="Asha's workspace" />);

    await user.click(
      screen.getByRole("button", { name: "Create my workspace" }),
    );

    expect(
      await screen.findByText("Confirm that you are 18 or older."),
    ).toBeVisible();
    expect(
      screen.getByText("Accept the privacy notice to continue."),
    ).toBeVisible();
  });

  it("submits the versioned consent through the same-origin BFF", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "00000000-0000-4000-8000-000000000010",
          name: "Asha's workspace",
          ownerUserId: "00000000-0000-4000-8000-000000000001",
          defaultCurrency: "INR",
          timezone: "Asia/Kolkata",
          createdAt: "2026-07-26T00:00:00Z",
          updatedAt: "2026-07-26T00:00:00Z",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    render(<OnboardingForm defaultName="Asha's workspace" />);

    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm that I am 18 or older/i,
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I have read and accept the privacy notice/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create my workspace" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/bff/v1/households");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      name: "Asha's workspace",
      defaultCurrency: "INR",
      ageConfirmed: true,
      privacyNoticeAccepted: true,
      privacyNoticeVersion: "foundation-v1",
    });
    expect(routerMocks.push).toHaveBeenCalledWith("/dashboard?onboarded=1");
    expect(routerMocks.refresh).toHaveBeenCalled();
  });
});
