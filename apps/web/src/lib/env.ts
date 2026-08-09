import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  AUTOPAY_GUARD_RUNTIME_MODE: z.enum(["LOCAL", "PRODUCTION"]),
  AUTH_SECRET: z
    .string()
    .min(32)
    .refine((value) => !/(placeholder|replace-with|change-me)/i.test(value)),
  AUTH_KEYCLOAK_ID: z.string().min(1),
  AUTH_KEYCLOAK_SECRET: z
    .string()
    .min(16)
    .refine((value) => !/(placeholder|replace-with|change-me)/i.test(value)),
  AUTH_KEYCLOAK_ISSUER: z.string().url(),
  AUTH_KEYCLOAK_INTERNAL_ISSUER: z.string().url().optional(),
  API_BASE_URL: z.string().url(),
  AUTH_URL: z.string().url(),
  AUTH_TRUST_HOST: z.enum(["true", "false"]).default("false"),
  WEB_OUTBOUND_ALLOWED_ORIGINS: z.string().min(1).optional(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function getServerEnvironment(): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse({
    AUTOPAY_GUARD_RUNTIME_MODE: process.env.AUTOPAY_GUARD_RUNTIME_MODE,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_KEYCLOAK_ID: process.env.AUTH_KEYCLOAK_ID,
    AUTH_KEYCLOAK_SECRET: process.env.AUTH_KEYCLOAK_SECRET,
    AUTH_KEYCLOAK_ISSUER: process.env.AUTH_KEYCLOAK_ISSUER,
    AUTH_KEYCLOAK_INTERNAL_ISSUER:
      process.env.AUTH_KEYCLOAK_INTERNAL_ISSUER || undefined,
    API_BASE_URL: process.env.API_BASE_URL,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    WEB_OUTBOUND_ALLOWED_ORIGINS:
      process.env.WEB_OUTBOUND_ALLOWED_ORIGINS || undefined,
  });

  if (!result.success) {
    const invalidKeys = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ].sort();
    throw new Error(
      `Invalid server configuration. Check: ${invalidKeys.join(", ")}.`,
    );
  }

  const invalidProductionKeys = productionConfigurationIssues(
    result.data,
    process.env.NODE_ENV,
  );
  if (invalidProductionKeys.length > 0) {
    throw new Error(
      `Invalid server configuration. Check: ${invalidProductionKeys.join(", ")}.`,
    );
  }

  return result.data;
}

function productionConfigurationIssues(
  environment: ServerEnvironment,
  nodeEnvironment: string | undefined,
): string[] {
  if (environment.AUTOPAY_GUARD_RUNTIME_MODE !== "PRODUCTION") {
    return [];
  }

  const invalidKeys = new Set<string>();
  if (nodeEnvironment !== "production") {
    invalidKeys.add("NODE_ENV");
  }
  if (!isProductionUrl(environment.AUTH_URL, true)) {
    invalidKeys.add("AUTH_URL");
  }
  if (!isProductionUrl(environment.AUTH_KEYCLOAK_ISSUER, false)) {
    invalidKeys.add("AUTH_KEYCLOAK_ISSUER");
  }
  if (
    !environment.AUTH_KEYCLOAK_INTERNAL_ISSUER ||
    !isProductionUrl(environment.AUTH_KEYCLOAK_INTERNAL_ISSUER, false)
  ) {
    invalidKeys.add("AUTH_KEYCLOAK_INTERNAL_ISSUER");
  }
  if (!isProductionUrl(environment.API_BASE_URL, true)) {
    invalidKeys.add("API_BASE_URL");
  }
  if (environment.AUTH_TRUST_HOST !== "false") {
    invalidKeys.add("AUTH_TRUST_HOST");
  }
  if (environment.AUTH_KEYCLOAK_ID !== "autopay-guard-web") {
    invalidKeys.add("AUTH_KEYCLOAK_ID");
  }

  if (
    !hasExactOutboundOrigins(
      environment.WEB_OUTBOUND_ALLOWED_ORIGINS,
      environment.AUTH_KEYCLOAK_INTERNAL_ISSUER,
      environment.API_BASE_URL,
    )
  ) {
    invalidKeys.add("WEB_OUTBOUND_ALLOWED_ORIGINS");
  }
  return [...invalidKeys].sort();
}

function hasExactOutboundOrigins(
  configuredOrigins: string | undefined,
  internalIssuer: string | undefined,
  apiBaseUrl: string,
): boolean {
  if (!configuredOrigins || !internalIssuer) {
    return false;
  }

  const parts = configuredOrigins.split(",").map((part) => part.trim());
  if (
    parts.length === 0 ||
    parts.some((part) => !part || !isProductionUrl(part, true))
  ) {
    return false;
  }

  const allowedOrigins = new Set(parts.map((part) => new URL(part).origin));
  if (allowedOrigins.size !== parts.length) {
    return false;
  }

  const expectedOrigins = new Set([
    new URL(internalIssuer).origin,
    new URL(apiBaseUrl).origin,
  ]);
  return (
    allowedOrigins.size === expectedOrigins.size &&
    [...allowedOrigins].every((origin) => expectedOrigins.has(origin))
  );
}

function isProductionUrl(value: string, originOnly: boolean): boolean {
  if (value !== value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isLocalOrReservedHost(url.hostname)
    ) {
      return false;
    }
    return !originOnly || url.pathname === "/";
  } catch {
    return false;
  }
}

function isLocalOrReservedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "test" ||
    host.endsWith(".test") ||
    host === "example" ||
    host.endsWith(".example") ||
    host === "invalid" ||
    host.endsWith(".invalid") ||
    host === "example.com" ||
    host.endsWith(".example.com") ||
    host === "example.org" ||
    host.endsWith(".example.org") ||
    host === "example.net" ||
    host.endsWith(".example.net") ||
    host.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    /^\d+$/.test(host) ||
    /^0x[0-9a-f]+$/.test(host) ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host === "::" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("fe80:") ||
    host.startsWith("169.254.")
  );
}

/**
 * Auth.js evaluates provider configuration while Next compiles route modules.
 * These non-secret local placeholders make compilation deterministic; every
 * request path calls getServerEnvironment() before authentication is used.
 */
export function getAuthBuildEnvironment() {
  const publicIssuer =
    process.env.AUTH_KEYCLOAK_ISSUER ??
    "http://localhost:8081/realms/autopay-guard";

  return {
    secret:
      process.env.AUTH_SECRET ??
      "build-only-placeholder-not-valid-for-runtime-use",
    clientId: process.env.AUTH_KEYCLOAK_ID ?? "autopay-guard-web",
    clientSecret: process.env.AUTH_KEYCLOAK_SECRET ?? "build-only-placeholder",
    publicIssuer,
    internalIssuer: process.env.AUTH_KEYCLOAK_INTERNAL_ISSUER ?? publicIssuer,
    trustHost: process.env.AUTH_TRUST_HOST === "true",
  };
}
