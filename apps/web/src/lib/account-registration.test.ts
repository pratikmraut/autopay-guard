import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  environment: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: mocks.auth, signIn: mocks.signIn }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));
vi.mock("@/lib/outbound-fetch", () => ({ fetchWithoutRedirects: mocks.fetch }));

import {
  accountContinuationUrl,
  accountStatus,
  beginRegistration,
} from "@/lib/account-registration";

describe("account registration boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue({
      AUTH_SELF_REGISTRATION_ENABLED: "true",
      API_BASE_URL: "http://api:8080",
    });
    mocks.auth.mockResolvedValue({
      user: { id: "fake-subject", email: "new@autopayguard.local" },
      apiAccessToken: "server-only-fake-token",
      appRoles: ["USER"],
    });
  });

  it("uses existing OIDC provider with standard registration hint and fixed callback", async () => {
    await beginRegistration();
    expect(mocks.signIn).toHaveBeenCalledWith(
      "keycloak",
      { redirectTo: "/enroll" },
      { prompt: "create" },
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses registration when disabled before any provider action", async () => {
    mocks.environment.mockReturnValue({
      AUTH_SELF_REGISTRATION_ENABLED: "false",
    });
    await expect(beginRegistration()).rejects.toThrow("not available");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("preserves only allowlisted continuation paths", () => {
    expect(accountContinuationUrl("/dashboard?month=2026-09")).toBe(
      "/account/continue?callbackUrl=%2Fdashboard%3Fmonth%3D2026-09",
    );
    expect(accountContinuationUrl("//evil.example")).toBe(
      "/account/continue?callbackUrl=%2Fonboarding",
    );
    expect(accountContinuationUrl("/account/continue")).toBe(
      "/account/continue?callbackUrl=%2Fonboarding",
    );
  });

  it("only reads account status, never creates an account on GET", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await accountStatus()).toBe("enrolled");
    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("http://api:8080/v1/me"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.objectContaining({
          authorization: "Bearer server-only-fake-token",
        }),
      }),
    );
  });

  it("routes only the explicit verified enrollment-required response", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "ACCOUNT_ENROLLMENT_REQUIRED" }), {
        status: 403,
      }),
    );
    expect(await accountStatus()).toBe("enrollment-required");
  });

  it.each([401, 403, 409, 422, 500])(
    "does not turn generic status %i into enrollment",
    async (status) => {
      mocks.fetch.mockResolvedValue(
        new Response(JSON.stringify({ detail: "Restricted account." }), {
          status,
        }),
      );
      expect(await accountStatus()).toBe("unavailable");
    },
  );

  it.each([
    { roles: [] },
    { roles: ["SUPPORT"] },
    { roles: ["USER", "GUIDE_EDITOR"] },
    { roles: ["USER", "USER"] },
  ])("does not enroll unexpected role set $roles", async ({ roles }) => {
    const session = await mocks.auth();
    mocks.auth.mockResolvedValue({ ...session, appRoles: roles });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "ACCOUNT_ENROLLMENT_REQUIRED" }), {
        status: 403,
      }),
    );
    expect(await accountStatus()).toBe("unavailable");
  });

  it("fails closed for expired sessions without sending an access token upstream", async () => {
    mocks.auth.mockResolvedValue({ error: "RefreshAccessTokenError" });
    expect(await accountStatus()).toBe("unavailable");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
