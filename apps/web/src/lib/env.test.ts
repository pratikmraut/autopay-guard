import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getServerEnvironment } from "@/lib/env";

const validEnvironment = {
  AUTOPAY_GUARD_RUNTIME_MODE: "LOCAL",
  AUTH_SECRET: "f".repeat(48),
  AUTH_KEYCLOAK_ID: "autopay-guard-web",
  AUTH_KEYCLOAK_SECRET: "k".repeat(32),
  AUTH_KEYCLOAK_ISSUER: "http://localhost:8081/realms/autopay-guard",
  API_BASE_URL: "http://localhost:8080",
  AUTH_URL: "http://localhost:3000",
  AUTH_TRUST_HOST: "true",
} as const;

const validProductionEnvironment = {
  ...validEnvironment,
  AUTOPAY_GUARD_RUNTIME_MODE: "PRODUCTION",
  AUTH_KEYCLOAK_ISSUER:
    "https://identity.private-beta.autopayguard.in/realms/autopay-guard",
  AUTH_KEYCLOAK_INTERNAL_ISSUER:
    "https://identity-internal.private-beta.autopayguard.in/realms/autopay-guard",
  API_BASE_URL: "https://api.private-beta.autopayguard.in",
  AUTH_URL: "https://guard.private-beta.autopayguard.in",
  AUTH_TRUST_HOST: "false",
  WEB_OUTBOUND_ALLOWED_ORIGINS:
    "https://identity-internal.private-beta.autopayguard.in,https://api.private-beta.autopayguard.in",
  NODE_ENV: "production",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server environment validation", () => {
  it("accepts explicit non-placeholder local configuration", () => {
    stubEnvironment(validEnvironment);
    expect(getServerEnvironment().AUTH_KEYCLOAK_ID).toBe("autopay-guard-web");
  });

  it("accepts an exact provider-independent production boundary", () => {
    stubEnvironment(validProductionEnvironment);
    expect(getServerEnvironment().AUTOPAY_GUARD_RUNTIME_MODE).toBe(
      "PRODUCTION",
    );
  });

  it.each([
    ["AUTH_SECRET", "build-only-placeholder-not-valid-for-runtime-use"],
    ["AUTH_KEYCLOAK_SECRET", "replace-with-local-keycloak-client-secret"],
  ] as const)("rejects a known placeholder in %s", (name, value) => {
    stubEnvironment({ ...validEnvironment, [name]: value });
    expect(() => getServerEnvironment()).toThrow(
      `Invalid server configuration. Check: ${name}.`,
    );
  });

  it.each([
    ["NODE_ENV", "development", "NODE_ENV"],
    ["AUTH_URL", "http://guard.private-beta.autopayguard.in", "AUTH_URL"],
    [
      "AUTH_KEYCLOAK_ISSUER",
      "https://identity.example.test/realms/autopay-guard",
      "AUTH_KEYCLOAK_ISSUER",
    ],
    [
      "AUTH_KEYCLOAK_ISSUER",
      "https://identity.example.com/realms/autopay-guard",
      "AUTH_KEYCLOAK_ISSUER",
    ],
    [
      "AUTH_KEYCLOAK_INTERNAL_ISSUER",
      "https://localhost/realms/autopay-guard",
      "AUTH_KEYCLOAK_INTERNAL_ISSUER",
    ],
    ["API_BASE_URL", "https://127.0.0.1", "API_BASE_URL"],
    ["API_BASE_URL", "https://10.0.0.1", "API_BASE_URL"],
    ["AUTH_URL", "https://localhost.", "AUTH_URL"],
    [
      "AUTH_KEYCLOAK_ISSUER",
      "https://identity.example.com./realms/autopay-guard",
      "AUTH_KEYCLOAK_ISSUER",
    ],
    [
      "AUTH_KEYCLOAK_INTERNAL_ISSUER",
      "https://[::ffff:127.0.0.1]/realms/autopay-guard",
      "AUTH_KEYCLOAK_INTERNAL_ISSUER",
    ],
    ["AUTH_TRUST_HOST", "true", "AUTH_TRUST_HOST"],
    ["AUTH_KEYCLOAK_ID", "different-web-client", "AUTH_KEYCLOAK_ID"],
    ["WEB_OUTBOUND_ALLOWED_ORIGINS", "", "WEB_OUTBOUND_ALLOWED_ORIGINS"],
    [
      "WEB_OUTBOUND_ALLOWED_ORIGINS",
      "https://identity-internal.private-beta.autopayguard.in,https://api.private-beta.autopayguard.in,https://unexpected.private-beta.autopayguard.in",
      "WEB_OUTBOUND_ALLOWED_ORIGINS",
    ],
    [
      "WEB_OUTBOUND_ALLOWED_ORIGINS",
      "https://identity-internal.private-beta.autopayguard.in/path,https://api.private-beta.autopayguard.in",
      "WEB_OUTBOUND_ALLOWED_ORIGINS",
    ],
  ] as const)(
    "rejects unsafe production value for %s",
    (name, value, expectedKey) => {
      stubEnvironment({ ...validProductionEnvironment, [name]: value });
      expect(() => getServerEnvironment()).toThrow(expectedKey);
    },
  );
});

function stubEnvironment(environment: Record<string, string>) {
  const names = [
    "AUTOPAY_GUARD_RUNTIME_MODE",
    "AUTH_SECRET",
    "AUTH_KEYCLOAK_ID",
    "AUTH_KEYCLOAK_SECRET",
    "AUTH_KEYCLOAK_ISSUER",
    "AUTH_KEYCLOAK_INTERNAL_ISSUER",
    "API_BASE_URL",
    "AUTH_URL",
    "AUTH_TRUST_HOST",
    "WEB_OUTBOUND_ALLOWED_ORIGINS",
    "NODE_ENV",
  ];
  for (const name of names) {
    vi.stubEnv(name, environment[name] ?? "");
  }
}
