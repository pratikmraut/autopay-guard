import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrustBanner } from "@/components/trust-banner";

describe("TrustBanner", () => {
  it("renders the required privacy promise exactly", () => {
    render(<TrustBanner />);

    expect(
      screen.getByText(
        "We never ask for your UPI PIN, bank password, OTP, or full payment credentials.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "Privacy promise" }),
    ).toBeVisible();
  });
});
