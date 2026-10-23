const PUBLIC_GET_PATHS = new Set([
  "/api/auth/callback/keycloak",
  "/api/auth/csrf",
  "/api/auth/error",
  "/api/auth/providers",
  "/api/auth/signin",
  "/api/auth/signin/keycloak",
  "/api/auth/signout",
]);

const PUBLIC_POST_PATHS = new Set([
  "/api/auth/callback/keycloak",
  "/api/auth/signin/keycloak",
  "/api/auth/signout",
]);

/**
 * Browser requests may reach only these canonical provider operations.
 * Auth.js normalizes action paths (including repeated/trailing slashes), so
 * blocking just the literal /session path is insufficient. Never delegate a
 * session action or an unrecognized alias: our session callback contains
 * server-only bearer and refresh tokens. Internal auth() does not use this
 * public route and continues to receive those server-only session fields.
 */
export function isPublicAuthRoute(method: string, pathname: string): boolean {
  if (method === "GET") {
    return PUBLIC_GET_PATHS.has(pathname);
  }
  if (method === "POST") {
    return PUBLIC_POST_PATHS.has(pathname);
  }
  return false;
}
