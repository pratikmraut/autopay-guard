import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportScreen, validateSelectedFile } from "@/components/import-screen";

const householdId = "00000000-0000-4000-8000-000000000123";
const importId = "10000000-0000-4000-8000-000000000001";
const itemOne = "20000000-0000-4000-8000-000000000001";
const itemTwo = "20000000-0000-4000-8000-000000000002";
const itemThree = "20000000-0000-4000-8000-000000000003";
let household = ownerHousehold();

vi.mock("@/components/household-scope", () => ({
  useSelectedHousehold: () => household,
}));

describe("ImportScreen", () => {
  beforeEach(() => {
    household = ownerHousehold();
    vi.restoreAllMocks();
  });

  it("shows the fixed template, exact safety copy, and an owner-only boundary", () => {
    const { rerender } = render(<ImportScreen />);

    const template = screen.getByRole("link", {
      name: "Download exact CSV template",
    });
    expect(template).toHaveAttribute(
      "href",
      "/autopay-guard-import-template-v1.csv",
    );
    expect(template).toHaveAttribute(
      "download",
      "autopay-guard-import-template-v1.csv",
    );
    expect(
      screen.getByText(
        "Preview only. Nothing is created until you confirm selected rows.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Imported commitments are private by default."),
    ).toBeVisible();
    expect(
      screen.getByText("AutoPay Guard does not contact a bank or provider."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Raw CSV content is processed in bounded request memory and is not committed to storage.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Unconfirmed previews expire no later than 24 hours after upload.",
      ),
    ).toBeVisible();

    household = { ...ownerHousehold(), canManage: false };
    rerender(<ImportScreen />);
    expect(
      screen.getByRole("heading", { name: "Owner-only workspace control" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Upload and preview" }),
    ).not.toBeInTheDocument();
  });

  it("uses the API preview as authority and keeps duplicate rows unchecked", async () => {
    const user = userEvent.setup();
    const fetchApi = installPreviewFetch();
    render(<ImportScreen />);

    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["template"], "fixture.CSV", { type: "text/csv" }),
    );
    submitUploadForm();

    expect(
      await screen.findByRole("heading", {
        name: "Select valid normalized rows",
      }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Row 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Row 2" })).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Row 3 — invalid" }),
    ).toBeDisabled();
    expect(screen.getByText("Duplicate in this file")).toBeVisible();
    expect(
      screen.getByText("The amount must be a positive plain decimal."),
    ).toBeVisible();
    expect(screen.queryByText("=HYPERLINK(secret)")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Unconfirmed preview availability deadline:/),
    ).toBeVisible();

    const upload = fetchApi.mock.calls[0];
    expect(String(upload?.[0])).toBe("/api/bff/v1/imports");
    expect(upload?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    const uploadHeaders = new Headers(upload?.[1]?.headers);
    expect(uploadHeaders.get("content-type")).toBeNull();
    expect(uploadHeaders.get("idempotency-key")).toMatch(/^csv-upload-/);
  });

  it("moves focus between mutually exclusive review and discard panels", async () => {
    const user = userEvent.setup();
    installPreviewFetch();
    render(<ImportScreen />);
    await uploadFixture(user);

    const review = await screen.findByRole("button", {
      name: "Review 1 selected row",
    });
    const discard = screen.getByRole("button", { name: "Discard preview" });
    await user.click(review);
    expect(
      screen.getByRole("heading", {
        name: "Confirm 1 private commitments",
      }),
    ).toHaveFocus();

    await user.click(discard);
    expect(
      screen.queryByRole("heading", {
        name: "Confirm 1 private commitments",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Discard this preview?" }),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Keep preview" }));
    expect(discard).toHaveFocus();
    await user.click(review);
    await user.click(screen.getByRole("button", { name: "Back to preview" }));
    expect(review).toHaveFocus();
  });

  it("locks row selection while confirming and uses exact ETag/idempotency", async () => {
    const user = userEvent.setup();
    let resolveConfirmation: ((response: Response) => void) | undefined;
    const confirmation = new Promise<Response>((resolve) => {
      resolveConfirmation = resolve;
    });
    const fetchApi = installPreviewFetch(confirmation);
    render(<ImportScreen />);
    await uploadFixture(user);

    await user.click(
      await screen.findByRole("button", {
        name: "Review 1 selected row",
      }),
    );
    const acknowledgement = screen.getByRole("checkbox", {
      name: /I reviewed the selected rows/,
    });
    expect(
      screen.getByRole("button", {
        name: "Create selected commitments",
      }),
    ).toBeDisabled();
    await user.click(acknowledgement);
    await user.click(
      screen.getByRole("button", {
        name: "Create selected commitments",
      }),
    );

    expect(screen.getByRole("checkbox", { name: "Row 1" })).toBeDisabled();
    expect(acknowledgement).toBeDisabled();
    const confirmCall = fetchApi.mock.calls.find(([url]) =>
      String(url).endsWith(`/v1/imports/${importId}/confirm`),
    );
    expect(confirmCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toEqual({
      selectedItemIds: [itemOne],
    });
    const headers = new Headers(confirmCall?.[1]?.headers);
    expect(headers.get("if-match")).toBe('"0"');
    expect(headers.get("idempotency-key")).toMatch(/^csv-confirm-/);

    resolveConfirmation?.(
      Response.json(confirmationBody(), {
        headers: { etag: '"1"' },
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Your selected rows are now tracked",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/Confirmation operated only on the normalized preview/),
    ).toBeVisible();
  });

  it("focuses a stale conflict and reloads the latest preview", async () => {
    const user = userEvent.setup();
    installPreviewFetch(
      Promise.resolve(
        new Response(null, {
          status: 412,
          headers: { "content-type": "application/problem+json" },
        }),
      ),
    );
    render(<ImportScreen />);
    await uploadFixture(user);
    await user.click(
      await screen.findByRole("button", { name: "Review 1 selected row" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the selected rows/,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Create selected commitments",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("changed in another tab");
    expect(
      screen.getByRole("button", { name: "Reload latest preview" }),
    ).toBeEnabled();
  });

  it("does not render selectable rows when an upload replay has expired", async () => {
    const user = userEvent.setup();
    installPreviewFetch(undefined, "EXPIRED");
    render(<ImportScreen />);
    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["template"], "fixture.csv", { type: "text/csv" }),
    );
    submitUploadForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This preview is no longer available. Start a new import.",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Select valid normalized rows",
      }),
    ).not.toBeInTheDocument();
  });

  it("retries an ambiguous upload with the same idempotency key", async () => {
    const user = userEvent.setup();
    const fetchApi = installPreviewFetch(undefined, "PREVIEW_READY", 1);
    render(<ImportScreen />);

    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["template"], "fixture.csv", { type: "text/csv" }),
    );
    submitUploadForm();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No commitment was confirmed",
    );
    submitUploadForm();
    expect(
      await screen.findByRole("heading", {
        name: "Select valid normalized rows",
      }),
    ).toBeVisible();

    const uploadCalls = fetchApi.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/bff/v1/imports" && init?.method === "POST",
    );
    expect(uploadCalls).toHaveLength(2);
    const keys = uploadCalls.map(([, init]) =>
      new Headers(init?.headers).get("idempotency-key"),
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("starts a new upload key after an explicit file selection change", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const fetchApi = installPreviewFetch(undefined, "PREVIEW_READY", 1);
    render(<ImportScreen />);

    const input = screen.getByLabelText("CSV file");
    await user.upload(
      input,
      new File(["first"], "first.csv", { type: "text/csv" }),
    );
    submitUploadForm();
    await screen.findByRole("alert");

    await user.upload(
      input,
      new File(["invalid"], "not-a-csv.txt", { type: "text/plain" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a safely named file ending in .csv.",
    );
    await user.upload(
      input,
      new File(["second"], "second.csv", { type: "text/csv" }),
    );
    submitUploadForm();
    await screen.findByRole("heading", {
      name: "Select valid normalized rows",
    });

    const uploadCalls = fetchApi.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/bff/v1/imports" && init?.method === "POST",
    );
    expect(uploadCalls).toHaveLength(2);
    expect(
      new Headers(uploadCalls[0]?.[1]?.headers).get("idempotency-key"),
    ).not.toBe(
      new Headers(uploadCalls[1]?.[1]?.headers).get("idempotency-key"),
    );
  });

  it("replays an ambiguous confirmation with the same key", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const fetchApi = installPreviewFetch(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new TypeError("connection reset"))
        : Promise.resolve(
            Response.json(confirmationBody(), {
              headers: { etag: '"1"' },
            }),
          );
    });
    render(<ImportScreen />);
    await uploadFixture(user);
    await user.click(
      await screen.findByRole("button", { name: "Review 1 selected row" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the selected rows/,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create selected commitments" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm whether rows were imported",
    );
    await user.click(
      screen.getByRole("button", { name: "Create selected commitments" }),
    );
    await screen.findByRole("heading", {
      name: "Your selected rows are now tracked",
    });

    const confirmCalls = fetchApi.mock.calls.filter(([url]) =>
      String(url).endsWith(`/v1/imports/${importId}/confirm`),
    );
    expect(confirmCalls).toHaveLength(2);
    expect(
      new Headers(confirmCalls[0]?.[1]?.headers).get("idempotency-key"),
    ).toBe(new Headers(confirmCalls[1]?.[1]?.headers).get("idempotency-key"));
  });
});

describe("validateSelectedFile", () => {
  it("accepts case-insensitive CSV suffixes and rejects unsafe names", () => {
    expect(
      validateSelectedFile(
        new File(["x"], "fixture.CsV", { type: "text/csv" }),
      ),
    ).toBeNull();
    expect(
      validateSelectedFile(
        new File(["x"], "../fixture.csv", { type: "text/csv" }),
      ),
    ).toMatch(/safely named/);
  });
});

async function uploadFixture(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("CSV file"),
    new File(["template"], "fixture.csv", { type: "text/csv" }),
  );
  submitUploadForm();
  await screen.findByRole("heading", {
    name: "Select valid normalized rows",
  });
}

function submitUploadForm() {
  const submitButton = screen.getByRole("button", {
    name: "Upload and preview",
  });
  const form = submitButton.closest("form");

  if (!form) {
    throw new Error("Upload form was not found.");
  }

  fireEvent.submit(form);
}

function installPreviewFetch(
  confirmation?: Promise<Response> | (() => Promise<Response>),
  getStatus: "PREVIEW_READY" | "EXPIRED" = "PREVIEW_READY",
  ambiguousUploadFailures = 0,
) {
  let uploadAttempts = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/bff/v1/imports" && init?.method === "POST") {
        uploadAttempts += 1;
        if (uploadAttempts <= ambiguousUploadFailures) {
          throw new TypeError("connection reset");
        }
        return Response.json(uploadBody(), {
          status: 201,
          headers: {
            etag: '"0"',
            location: `/api/bff/v1/imports/${importId}`,
          },
        });
      }
      if (url === `/api/bff/v1/imports/${importId}` && init?.method === "GET") {
        return Response.json(previewBody(getStatus), {
          headers: { etag: getStatus === "PREVIEW_READY" ? '"0"' : '"1"' },
        });
      }
      if (
        url === `/api/bff/v1/imports/${importId}/confirm` &&
        init?.method === "POST"
      ) {
        return (
          (typeof confirmation === "function"
            ? confirmation()
            : confirmation) ??
          Promise.resolve(
            Response.json(confirmationBody(), {
              headers: { etag: '"1"' },
            }),
          )
        );
      }
      if (
        url === `/api/bff/v1/imports/${importId}` &&
        init?.method === "DELETE"
      ) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
}

function ownerHousehold() {
  return {
    id: householdId,
    name: "Demo household",
    defaultCurrency: "INR",
    timezone: "Asia/Kolkata",
    canManage: true,
  };
}

function uploadBody() {
  return {
    id: importId,
    householdId,
    status: "PREVIEW_READY",
    rawByteCount: 100,
    expiresAt: "2026-07-30T10:00:00Z",
    totalItemCount: 3,
    validItemCount: 2,
    invalidItemCount: 1,
    duplicateItemCount: 1,
    version: 0,
    createdAt: "2026-07-29T10:00:00Z",
    updatedAt: "2026-07-29T10:00:00Z",
  };
}

function previewBody(status: "PREVIEW_READY" | "EXPIRED") {
  return {
    ...uploadBody(),
    status,
    rawProcessedAt: "2026-07-29T10:00:00Z",
    selectedItemCount: 0,
    createdCommitmentCount: 0,
    version: status === "EXPIRED" ? 1 : 0,
    items:
      status === "PREVIEW_READY"
        ? [
            validItem(itemOne, 1, "NONE", "M6 Stream"),
            validItem(itemTwo, 2, "IN_FILE", "M6 Stream duplicate"),
            {
              id: itemThree,
              rowNumber: 3,
              valid: false,
              duplicateKind: null,
              selected: null,
              createdCommitmentId: null,
              errors: [
                {
                  code: "AMOUNT_INVALID",
                  message: "The amount must be a positive plain decimal.",
                },
              ],
              preview: null,
            },
          ]
        : [],
  };
}

function validItem(
  id: string,
  rowNumber: number,
  duplicateKind: "NONE" | "IN_FILE",
  name: string,
) {
  return {
    id,
    rowNumber,
    valid: true,
    duplicateKind,
    selected: false,
    createdCommitmentId: null,
    errors: [],
    preview: {
      name,
      category: "SUBSCRIPTION",
      amountMinor: 25000,
      currency: "INR",
      frequency: "MONTHLY",
      nextDueDate: "2026-08-15",
      monthDayPolicy: "ANCHOR_DAY",
      paymentRail: "UPI_AUTOPAY",
      maskedPaymentLabel: "UPI ••42",
      merchantId: null,
    },
  };
}

function confirmationBody() {
  return {
    importId,
    status: "CONFIRMED",
    selectedItemCount: 1,
    createdCommitmentCount: 1,
    commitmentIds: ["30000000-0000-4000-8000-000000000001"],
    rawProcessedAt: "2026-07-29T10:05:00Z",
    version: 1,
  };
}
