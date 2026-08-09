import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/lib/safe-return-to";

describe("safeReturnTo", () => {
  it("preserves the established fixed same-origin user routes", () => {
    expect(safeReturnTo("/dashboard?onboarded=1")).toBe(
      "/dashboard?onboarded=1",
    );
    expect(safeReturnTo("/onboarding")).toBe("/onboarding");
    expect(safeReturnTo("/more")).toBe("/more");
    expect(safeReturnTo("/household?from=signin")).toBe(
      "/household?from=signin",
    );
    expect(safeReturnTo("/settings/privacy")).toBe("/settings/privacy");
    expect(safeReturnTo("/settings/support")).toBe("/settings/support");
    expect(safeReturnTo("/privacy")).toBe("/onboarding");
  });

  it.each([
    "/admin/privacy",
    "/admin/guides",
    "/admin/audit",
    "/support/diagnostics",
  ])("preserves the fixed staff callback route %s", (callbackUrl) => {
    expect(safeReturnTo(callbackUrl)).toBe(callbackUrl);
    expect(safeReturnTo(`${callbackUrl}?from=signin`)).toBe(
      `${callbackUrl}?from=signin`,
    );
  });

  it("preserves exact dynamic app routes with UUID segments", () => {
    const first = "10000000-0000-4000-8000-000000000001";
    const second = "20000000-0000-4000-9000-000000000002";
    expect(safeReturnTo(`/admin/guides/${first}`)).toBe(
      `/admin/guides/${first}`,
    );
    expect(safeReturnTo(`/admin/guides/drafts/${first}`)).toBe(
      `/admin/guides/drafts/${first}`,
    );
    expect(
      safeReturnTo(
        `/commitments/${first}/cancellation/attempts/${second}?from=list`,
      ),
    ).toBe(`/commitments/${first}/cancellation/attempts/${second}?from=list`);
    expect(safeReturnTo(`/notifications/${first}`)).toBe(
      `/notifications/${first}`,
    );
  });

  it("rejects network paths and backslash-normalized redirects", () => {
    expect(safeReturnTo("//evil.example")).toBe("/onboarding");
    expect(safeReturnTo("/\\evil.example")).toBe("/onboarding");
    expect(safeReturnTo("https://evil.example/dashboard")).toBe("/onboarding");
    expect(safeReturnTo("https://evil.example/admin/privacy")).toBe(
      "/onboarding",
    );
  });

  it("rejects route lookalikes, nested paths, fragments, and duplicate values", () => {
    expect(safeReturnTo("/household/extra")).toBe("/onboarding");
    expect(safeReturnTo("/settings/privacy/extra")).toBe("/onboarding");
    expect(safeReturnTo("/settings/support/")).toBe("/onboarding");
    expect(safeReturnTo("/more.evil")).toBe("/onboarding");
    expect(safeReturnTo("/admin/privacy/extra")).toBe("/onboarding");
    expect(safeReturnTo("/admin/guides/guide-id")).toBe("/onboarding");
    expect(
      safeReturnTo("/ADMIN/guides/10000000-0000-4000-8000-000000000001"),
    ).toBe("/onboarding");
    expect(
      safeReturnTo("/admin/guides/10000000-0000-4000-8000-000000000001/extra"),
    ).toBe("/onboarding");
    expect(safeReturnTo("/support/diagnostics/")).toBe("/onboarding");
    expect(safeReturnTo("/admin/%70rivacy")).toBe("/onboarding");
    expect(safeReturnTo("/admin/privacy#secret")).toBe("/admin/privacy");
    expect(safeReturnTo(["/admin/privacy", "//evil.example"])).toBe(
      "/onboarding",
    );
  });
});
