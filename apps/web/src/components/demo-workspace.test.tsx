import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoWorkspace } from "@/components/demo-workspace";

afterEach(() => vi.restoreAllMocks());

describe("public isolated demo workspace", () => {
  it("shows an honest, unauthenticated sample with reconciled totals", () => {
    render(<DemoWorkspace />);
    expect(
      screen.getByText(
        /Sample data only. Changes stay in this tab and reset on refresh/,
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    expect(screen.getByLabelText("12-month sample total")).toHaveTextContent(
      "₹54,000",
    );
    expect(
      within(
        screen.getByRole("list", { name: "Active sample commitments" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(4);
    expect(
      screen.getByRole("link", { name: "Create account" }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin",
    );
  });

  it("creates, edits and archives sample values with exact projection reconciliation and no I/O", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Demo must not call the network"));
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const storageReadSpy = vi.spyOn(Storage.prototype, "getItem");
    render(<DemoWorkspace />);
    await user.click(
      screen.getByRole("button", { name: "Add sample commitment" }),
    );
    await user.type(
      screen.getByLabelText("Fictional commitment name"),
      "Portfolio Sample",
    );
    await user.type(screen.getByLabelText("Amount (INR)"), "250.25");
    await user.click(
      screen.getByRole("button", { name: "Add to this sample" }),
    );
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,750.25",
    );
    expect(screen.getByLabelText("12-month sample total")).toHaveTextContent(
      "₹57,003",
    );

    await user.click(
      screen.getByRole("button", { name: "Edit Portfolio Sample" }),
    );
    await user.clear(screen.getByLabelText("Amount (INR)"));
    await user.type(screen.getByLabelText("Amount (INR)"), "275");
    await user.click(
      screen.getByRole("button", { name: "Save sample changes" }),
    );
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,775",
    );
    expect(screen.getByLabelText("12-month sample total")).toHaveTextContent(
      "₹57,300",
    );

    await user.click(
      screen.getByRole("button", { name: "Archive Portfolio Sample" }),
    );
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,775",
    );
    await user.click(screen.getByRole("button", { name: "Confirm archive" }));
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    expect(screen.getByLabelText("12-month sample total")).toHaveTextContent(
      "₹54,000",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No subscription was cancelled",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(storageReadSpy).not.toHaveBeenCalled();
  });

  it("preserves state on invalid input, cancels edits and keeps estimate labels honest", async () => {
    const user = userEvent.setup();
    render(<DemoWorkspace />);
    await user.click(
      screen.getByRole("button", { name: "Edit Monsoon Utility Demo" }),
    );
    expect(screen.getByLabelText("Amount type")).toHaveValue("estimated");
    await user.clear(screen.getByLabelText("Amount (INR)"));
    await user.type(screen.getByLabelText("Amount (INR)"), "1e3");
    await user.click(
      screen.getByRole("button", { name: "Save sample changes" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nothing has been changed",
    );
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByLabelText(/^Amount \(INR\)/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    await user.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add sample commitment" }),
    ).toHaveFocus();
  });

  it("searches only the list, preserves all projection totals, and moves month-end schedules", async () => {
    const user = userEvent.setup();
    render(<DemoWorkspace />);
    await user.type(
      screen.getByLabelText("Search sample commitments"),
      "stream",
    );
    expect(
      within(
        screen.getByRole("list", { name: "Active sample commitments" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    expect(screen.getByText("30 Sept 2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next sample month" }));
    expect(
      screen.getByRole("heading", { name: "Scheduled in October 2026" }),
    ).toBeVisible();
    expect(screen.getByText("31 Oct 2026")).toBeVisible();
    await user.clear(screen.getByLabelText("Search sample commitments"));
    await user.type(
      screen.getByLabelText("Search sample commitments"),
      "no fictional match",
    );
    expect(screen.getByText(/No matching sample commitments/)).toBeVisible();
  });

  it("requires confirmation to reset and never persists changes into a fresh mount", async () => {
    const user = userEvent.setup();
    const first = render(<DemoWorkspace />);
    await user.click(
      screen.getByRole("button", { name: "Archive StreamBox Demo" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep active" }));
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    await user.click(
      screen.getByRole("button", { name: "Archive StreamBox Demo" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm archive" }));
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,000",
    );
    await user.click(screen.getByRole("button", { name: "Reset sample" }));
    await user.click(screen.getByRole("button", { name: "Keep my changes" }));
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,000",
    );
    await user.click(screen.getByRole("button", { name: "Reset sample" }));
    await user.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    await user.click(
      screen.getByRole("button", { name: "Archive StreamBox Demo" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm archive" }));
    first.unmount();
    render(<DemoWorkspace />);
    expect(screen.getByLabelText("Monthly sample total")).toHaveTextContent(
      "₹4,500",
    );
    expect(
      screen.getByRole("button", { name: "Edit StreamBox Demo" }),
    ).toBeVisible();
  });
});
