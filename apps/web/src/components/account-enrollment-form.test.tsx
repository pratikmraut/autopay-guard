import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountEnrollmentForm } from "@/components/account-enrollment-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const notice = {
  noticeVersion: "foundation-v1",
  contentSha256: "a".repeat(64),
  acknowledgementType: "ACKNOWLEDGED",
};

describe("AccountEnrollmentForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    router.push.mockReset();
    router.refresh.mockReset();
  });

  it("reads the notice without provisioning and requires both unchecked confirmations", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(notice)));
    render(<AccountEnrollmentForm />);
    const submit = await screen.findByRole("button", {
      name: "Create my app account",
    });
    expect(submit).toBeDisabled();
    expect(
      screen
        .getAllByRole("checkbox")
        .every((box) => !(box as HTMLInputElement).checked),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bff/v1/privacy/notices/current",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("submits exact versioned consent through BFF and continues to private workspace setup", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(notice)))
      .mockResolvedValueOnce(new Response("{}"));
    render(<AccountEnrollmentForm />);
    await screen.findByRole("button", { name: "Create my app account" });
    await user.click(
      screen.getByRole("checkbox", { name: /I confirm that I am 18/ }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /I have read and accept/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create my app account" }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/bff/v1/account/enrollment",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          ageConfirmed: true,
          privacyNoticeAccepted: true,
          privacyNoticeVersion: "foundation-v1",
        }),
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/onboarding");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh notice and renewed acceptance after a conflict", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(notice)))
      .mockResolvedValueOnce(new Response("{}", { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...notice, noticeVersion: "foundation-v2" }),
        ),
      );
    render(<AccountEnrollmentForm />);
    await screen.findByRole("button", { name: "Create my app account" });
    for (const checkbox of screen.getAllByRole("checkbox"))
      await user.click(checkbox);
    await user.click(
      screen.getByRole("button", { name: "Create my app account" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("state changed");
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reload notice" }));
    expect(
      await screen.findByRole("button", { name: "Create my app account" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /I have read and accept/ }),
    ).not.toBeChecked();
    expect(
      screen.getByText(/Current privacy notice · Version foundation-v2/),
    ).toBeVisible();
  });

  it("does not allow submission without a valid current notice", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...notice, noticeVersion: "<invalid>" })),
    );
    render(<AccountEnrollmentForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not load",
    );
    expect(
      screen.queryByRole("button", { name: "Create my app account" }),
    ).not.toBeInTheDocument();
  });

  it.each([403, 422, 429, 500])(
    "handles denied or failed enrollment %i without navigating",
    async (status) => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(notice)))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: "private provider detail" }), {
            status,
          }),
        );
      render(<AccountEnrollmentForm />);
      await screen.findByRole("button", { name: "Create my app account" });
      for (const checkbox of screen.getAllByRole("checkbox"))
        await user.click(checkbox);
      await user.click(
        screen.getByRole("button", { name: "Create my app account" }),
      );
      await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
      expect(screen.getByRole("alert")).not.toHaveTextContent(
        "private provider detail",
      );
      expect(router.push).not.toHaveBeenCalled();
    },
  );
});
