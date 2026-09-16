import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  environment: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ signIn: mocks.signIn, auth: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnvironment: mocks.environment }));

import {
  beginLocalDemoLogin,
  isLocalDemoLoginAvailable,
  LOCAL_DEMO_USERNAME,
} from "@/lib/local-demo-login";

const localEnvironment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  AUTH_URL: "http://localhost:3000",
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
} as const;

describe("local demo account sign-in", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue(localEnvironment);
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses only the reserved username hint through the existing OIDC provider", async () => {
    await beginLocalDemoLogin("/dashboard?month=2026-09");

    expect(LOCAL_DEMO_USERNAME).toBe("demo@autopayguard.local");
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith(
      "keycloak",
      {
        redirectTo:
          "/account/continue?callbackUrl=%2Fdashboard%3Fmonth%3D2026-09",
      },
      { login_hint: "demo@autopayguard.local", prompt: "login" },
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("permits the exact LOCAL runtime even when the local web build is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isLocalDemoLoginAvailable(localEnvironment)).toBe(true);
    await beginLocalDemoLogin("/dashboard");
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it.each([
    { AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION" as const },
    { AUTH_URL: "https://guard.autopayguard.in" },
    { AUTH_URL: "http://127.0.0.1:3000" },
    { AUTH_URL: "http://localhost:3001" },
    { AUTH_URL: "http://localhost:3000/" },
    { AUTH_URL: "http://localhost:3000@outside.invalid" },
    {
      AUTH_KEYCLOAK_ISSUER:
        "https://identity.autopayguard.in/realms/autopay-guard",
    },
    { AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/another-realm" },
    {
      AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard?demo=1",
    },
    { AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard/" },
  ])(
    "rejects runtime or endpoint drift before provider access: %j",
    async (change) => {
      const environment = { ...localEnvironment, ...change };
      mocks.environment.mockReturnValue(environment);

      expect(isLocalDemoLoginAvailable(environment)).toBe(false);
      await expect(beginLocalDemoLogin("/dashboard")).rejects.toThrow(
        "Local demo account sign-in is not available.",
      );
      expect(mocks.signIn).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("rechecks configuration for every submission", async () => {
    expect(isLocalDemoLoginAvailable(localEnvironment)).toBe(true);
    mocks.environment.mockReturnValue({
      ...localEnvironment,
      AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION",
    });

    await expect(beginLocalDemoLogin()).rejects.toThrow("not available");
    expect(mocks.environment).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    ["/dashboard"],
    "//outside.invalid",
    "/account/continue",
  ])(
    "preserves the existing callback allowlist for %j",
    async (callbackUrl) => {
      await beginLocalDemoLogin(callbackUrl);
      expect(mocks.signIn).toHaveBeenCalledWith(
        "keycloak",
        { redirectTo: "/account/continue?callbackUrl=%2Fonboarding" },
        { login_hint: "demo@autopayguard.local", prompt: "login" },
      );
    },
  );
});
