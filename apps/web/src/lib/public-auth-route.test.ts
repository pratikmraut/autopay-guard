import { describe, expect, it } from "vitest";

import { isPublicAuthRoute } from "@/lib/public-auth-route";

describe("public auth operation allowlist", () => {
  it.each([
    "/api/auth/session",
    "/api/auth/session/",
    "/api/auth/session///",
    "/api/auth//session",
    "/api/auth///session//",
    "/api/authsession",
    "/api/auth/%73ession",
    "/api/auth/sess%69on",
    "/api/auth/%2Fsession",
    "/api/auth/session%2F",
    "/api/auth/%2573ession",
    "/api/auth/other/../session",
    "/api/auth/other/%2e%2e/session",
    "/api/auth/SESSION",
    "/api/auth/session/keycloak",
    "/api/auth/session;ignored",
  ])("never exposes a browser session at %s", (pathname) => {
    expect(isPublicAuthRoute("GET", pathname)).toBe(false);
    expect(isPublicAuthRoute("POST", pathname)).toBe(false);
  });

  it.each([
    "/api/auth/callback/keycloak",
    "/api/auth/csrf",
    "/api/auth/error",
    "/api/auth/providers",
    "/api/auth/signin",
    "/api/auth/signin/keycloak",
    "/api/auth/signout",
  ])("preserves canonical browser GET %s", (pathname) => {
    expect(isPublicAuthRoute("GET", pathname)).toBe(true);
  });

  it.each([
    "/api/auth/callback/keycloak",
    "/api/auth/signin/keycloak",
    "/api/auth/signout",
  ])("preserves canonical provider POST %s", (pathname) => {
    expect(isPublicAuthRoute("POST", pathname)).toBe(true);
  });

  it.each([
    "/api/auth/callback/unknown-provider",
    "/api/auth/signin/unknown-provider",
    "/api/auth/callback/keycloak/",
    "/api/auth//callback/keycloak",
    "/api/auth/callback/%6beycloak",
    "/api/auth/unrecognized",
    "/api/auth/callback/keycloak/extra",
  ])(
    "does not delegate noncanonical or unconfigured operations: %s",
    (pathname) => {
      expect(isPublicAuthRoute("GET", pathname)).toBe(false);
      expect(isPublicAuthRoute("POST", pathname)).toBe(false);
    },
  );

  it("rejects other HTTP methods and unsupported POST operations", () => {
    expect(isPublicAuthRoute("PUT", "/api/auth/signout")).toBe(false);
    expect(isPublicAuthRoute("DELETE", "/api/auth/signout")).toBe(false);
    expect(isPublicAuthRoute("POST", "/api/auth/providers")).toBe(false);
    expect(isPublicAuthRoute("POST", "/api/auth/csrf")).toBe(false);
  });
});
