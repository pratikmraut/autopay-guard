import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Household } from "@autopay-guard/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitmentCreateScreen } from "@/components/commitment-create-screen";

const scopeMocks = vi.hoisted(() => ({
  household: {
    id: "00000000-0000-4000-8000-000000000010",
    name: "Workspace A",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    defaultCurrency: "INR",
    timezone: "Asia/Kolkata",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  } as Household,
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => scopeMocks.household,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

describe("CommitmentCreateScreen", () => {
  beforeEach(() => {
    scopeMocks.household = {
      ...scopeMocks.household,
      id: "00000000-0000-4000-8000-000000000010",
      name: "Workspace A",
      defaultCurrency: "INR",
      timezone: "Asia/Kolkata",
    };
    routerMocks.push.mockReset();
    routerMocks.refresh.mockReset();
    vi.restoreAllMocks();
  });

  it("discards the previous workspace draft and defaults when scope changes", async () => {
    const user = userEvent.setup();
    const view = render(<CommitmentCreateScreen />);
    const displayName = screen.getByLabelText(/^Display name/);
    const anchorDate = screen.getByLabelText(/^Billing anchor/);

    await user.type(displayName, "Workspace A draft");
    await user.clear(anchorDate);
    await user.type(anchorDate, "2027-01-01");
    expect(displayName).toHaveValue("Workspace A draft");
    expect(anchorDate).toHaveValue("2027-01-01");

    scopeMocks.household = {
      ...scopeMocks.household,
      id: "00000000-0000-4000-8000-000000000011",
      name: "Workspace B",
      defaultCurrency: "KWD",
      timezone: "Pacific/Honolulu",
    };
    view.rerender(<CommitmentCreateScreen />);

    expect(screen.getByLabelText(/^Display name/)).toHaveValue("");
    expect(screen.getByLabelText(/^Billing anchor/)).not.toHaveValue(
      "2027-01-01",
    );
    expect(screen.getByLabelText(/^Fixed amount \(KWD\)/)).toHaveValue("");
    expect(screen.getByText("Inherited from Workspace B")).toBeVisible();
  });
});
