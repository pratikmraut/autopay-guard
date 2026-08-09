export const APP_CLIENT_ROLES = [
  "USER",
  "GUIDE_ADMIN",
  "PRIVACY_ADMIN",
  "AUDIT_READ",
  "SUPPORT_READ",
] as const;

export type AppRole = (typeof APP_CLIENT_ROLES)[number];

const API_CLIENT_ID = "autopay-guard-api";

export function extractAppClientRoles(
  encodedAccessToken: string | undefined,
): AppRole[] {
  if (!encodedAccessToken) {
    return [];
  }
  const segments = encodedAccessToken.split(".");
  if (segments.length !== 3 || !segments[1]) {
    return [];
  }

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as unknown;
    if (!isObject(payload) || !isObject(payload.resource_access)) {
      return [];
    }
    const apiClientAccess = payload.resource_access[API_CLIENT_ID];
    if (!isObject(apiClientAccess)) {
      return [];
    }
    const roles = apiClientAccess.roles;
    if (!Array.isArray(roles) || roles.length !== 1 || !isAppRole(roles[0])) {
      return [];
    }
    return [roles[0]];
  } catch {
    return [];
  }
}

function isAppRole(value: unknown): value is AppRole {
  return (
    typeof value === "string" &&
    APP_CLIENT_ROLES.some((allowedRole) => allowedRole === value)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
