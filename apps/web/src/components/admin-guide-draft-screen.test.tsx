import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminGuideDraftScreen } from "@/components/admin-guide-draft-screen";

const draftId = "00000000-0000-4000-8000-000000000301";
const guideId = "00000000-0000-4000-8000-000000000302";

const draft = {
  draftId,
  guideId,
  guideVersion: 2,
  status: "DRAFT",
  riskNotice: "Review the fictional account before making a local decision.",
  structuralReviewedAt: "2026-07-28T00:00:00Z",
  reviewIntervalDays: 60,
  steps: [
    {
      track: "SERVICE",
      sequenceNumber: 1,
      actionType: "SAFE_LINK",
      title: "Open fictional service settings",
      instruction: "Use the fictional local settings page.",
      targetKey: "fixture-service-settings",
      targetUri: "https://fixture.example/cancel",
    },
    {
      track: "SERVICE",
      sequenceNumber: 2,
      actionType: "INFORMATION",
      title: "Record the local result",
      instruction: "Keep a local record of what you observed.",
      targetKey: null,
      targetUri: null,
    },
    {
      track: "PAYMENT_MANDATE",
      sequenceNumber: 1,
      actionType: "APP_DEEP_LINK",
      title: "Review the fictional mandate",
      instruction: "Open the local mandate checklist.",
      targetKey: "fixture-mandate-check",
      targetUri: "autopayguard-demo://mandate/review",
    },
    {
      track: "PAYMENT_MANDATE",
      sequenceNumber: 2,
      actionType: "INFORMATION",
      title: "Keep tracks separate",
      instruction: "Confirm the service and payment mandate independently.",
      targetKey: null,
      targetUri: null,
    },
  ],
  version: 4,
  createdAt: "2026-07-28T00:00:00Z",
  updatedAt: "2026-07-28T00:00:00Z",
};

describe("AdminGuideDraftScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits only editable fields with the current draft ETag", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url === `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}` &&
          !init?.method
        ) {
          return jsonResponse(draft);
        }
        if (
          url === `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}` &&
          init?.method === "PATCH"
        ) {
          const body = JSON.parse(String(init.body)) as {
            riskNotice: string;
            reviewIntervalDays: number;
            steps: Array<{
              title: string;
              instruction: string;
            }>;
          };
          return jsonResponse({
            ...draft,
            ...body,
            steps: draft.steps.map((step, index) => ({
              ...step,
              title: body.steps[index]?.title,
              instruction: body.steps[index]?.instruction,
            })),
            version: 5,
            updatedAt: "2026-07-28T01:00:00Z",
          });
        }
        throw new Error(`Unexpected test request: ${init?.method} ${url}`);
      });

    render(<AdminGuideDraftScreen draftId={draftId} />);
    const riskNotice = await screen.findByRole("textbox", {
      name: "Risk notice",
    });
    const reviewInterval = screen.getByRole("spinbutton", {
      name: "Review interval in days",
    });
    const titles = screen.getAllByRole("textbox", { name: "Step title" });
    const instructions = screen.getAllByRole("textbox", {
      name: "Step instruction",
    });

    expect(screen.getByText("fixture-service-settings")).toBeVisible();
    expect(screen.getByText("https://fixture.example/cancel")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: /target uri/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.change(riskNotice, {
      target: {
        value: "Use only this fictional local guide and review each step.",
      },
    });
    fireEvent.change(reviewInterval, { target: { value: "45" } });
    fireEvent.change(titles[0]!, {
      target: { value: "Review fictional service controls" },
    });
    fireEvent.change(instructions[0]!, {
      target: {
        value:
          "Review the fictional local service controls without contacting a provider.",
      },
    });
    await user.click(screen.getByRole("button", { name: "Save draft text" }));

    expect(
      await screen.findByText("Draft text saved with conditional version 5."),
    ).toBeVisible();
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/cancellation-guide-drafts/${draftId}`) &&
        init?.method === "PATCH",
    );
    const init = patchCall?.[1];
    expect(new Headers(init?.headers).get("if-match")).toBe('"4"');
    expect(new Headers(init?.headers).get("idempotency-key")).toBeNull();
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      riskNotice: "Use only this fictional local guide and review each step.",
      reviewIntervalDays: 45,
      steps: [
        {
          track: "SERVICE",
          sequenceNumber: 1,
          title: "Review fictional service controls",
          instruction:
            "Review the fictional local service controls without contacting a provider.",
        },
        {
          track: "SERVICE",
          sequenceNumber: 2,
          title: "Record the local result",
          instruction: "Keep a local record of what you observed.",
        },
        {
          track: "PAYMENT_MANDATE",
          sequenceNumber: 1,
          title: "Review the fictional mandate",
          instruction: "Open the local mandate checklist.",
        },
        {
          track: "PAYMENT_MANDATE",
          sequenceNumber: 2,
          title: "Keep tracks separate",
          instruction: "Confirm the service and payment mandate independently.",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("actionType");
    expect(JSON.stringify(body)).not.toContain("targetKey");
    expect(JSON.stringify(body)).not.toContain("targetUri");
    expect(JSON.stringify(body)).not.toContain("merchant");
    expect(JSON.stringify(body)).not.toContain("structuralReviewedAt");
  });

  it("blocks invalid editable text before any PATCH request", async () => {
    const fetchMock = installDraftGet();

    render(<AdminGuideDraftScreen draftId={draftId} />);
    const firstTitle = (
      await screen.findAllByRole("textbox", { name: "Step title" })
    )[0]!;
    fireEvent.change(firstTitle, { target: { value: "" } });

    expect(
      screen.getByText("Enter 1 through 160 non-blank characters."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save draft text" }),
    ).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
  });

  it("publishes with an exact confirmation, bodyless POST, ETag, and idempotency key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url === `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}` &&
          !init?.method
        ) {
          return jsonResponse(draft);
        }
        if (
          url ===
            `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}/publish` &&
          init?.method === "POST"
        ) {
          return jsonResponse({
            guideId,
            publishedVersion: 2,
            catalogState: "ACTIVE",
            catalogVersion: 7,
            publishedAt: "2026-07-28T02:00:00Z",
          });
        }
        throw new Error(`Unexpected test request: ${init?.method} ${url}`);
      });

    render(<AdminGuideDraftScreen draftId={draftId} />);
    const publish = await screen.findByRole("button", {
      name: "Publish fictional guide",
    });
    expect(publish).toBeDisabled();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Type PUBLISH VERSION 2",
      }),
      { target: { value: "PUBLISH VERSION 2" } },
    );
    expect(publish).toBeEnabled();
    fireEvent.click(publish);

    expect(
      await screen.findByRole("heading", {
        name: "Fictional guide published",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Version 2 is now the current fictional local guide\. This does not verify a merchant or link, and no provider was contacted\./i,
      ),
    ).toBeVisible();

    const publishCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/${draftId}/publish`) && init?.method === "POST",
    );
    const init = publishCall?.[1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(new Headers(init?.headers).get("if-match")).toBe('"4"');
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^guide-draft-publish-/,
    );
  });

  it("preserves unsaved text when a conditional save is stale", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url === `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}` &&
        !init?.method
      ) {
        return jsonResponse(draft);
      }
      if (
        url === `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}` &&
        init?.method === "PATCH"
      ) {
        return jsonResponse({ detail: "Stale draft." }, 412);
      }
      throw new Error(`Unexpected test request: ${init?.method} ${url}`);
    });

    render(<AdminGuideDraftScreen draftId={draftId} />);
    const riskNotice = await screen.findByRole("textbox", {
      name: "Risk notice",
    });
    fireEvent.change(riskNotice, {
      target: {
        value:
          "My unsaved fictional draft text remains visible after conflict.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft text" }));

    expect(
      await screen.findByText(/This draft changed in another session/i),
    ).toBeVisible();
    expect(riskNotice).toHaveValue(
      "My unsaved fictional draft text remains visible after conflict.",
    );
    expect(
      screen.getByRole("button", { name: "Reload latest draft" }),
    ).toBeVisible();
  });
});

function installDraftGet() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url === `/api/bff/v1/admin/cancellation-guide-drafts/${draftId}` &&
        !init?.method
      ) {
        return jsonResponse(draft);
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
