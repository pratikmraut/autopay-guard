import "server-only";

import { auth, signIn } from "@/auth";
import { getServerEnvironment } from "@/lib/env";
import { fetchWithoutRedirects } from "@/lib/outbound-fetch";
import { safeReturnTo } from "@/lib/safe-return-to";

export type AccountStatus = "enrolled" | "enrollment-required" | "unavailable";

export function accountContinuationUrl(callbackUrl?: string | string[]) {
  return `/account/continue?callbackUrl=${encodeURIComponent(safeReturnTo(callbackUrl))}`;
}

export async function beginRegistration() {
  const environment = getServerEnvironment();
  if (environment.AUTH_SELF_REGISTRATION_ENABLED !== "true") {
    throw new Error("Account registration is not available.");
  }
  // Keycloak's standard OIDC registration hint uses the same Auth.js provider,
  // callback and PKCE/state/nonce checks as sign-in. Never hand-build an IdP URL.
  await signIn("keycloak", { redirectTo: "/enroll" }, { prompt: "create" });
}

export async function accountStatus(): Promise<AccountStatus> {
  const environment = getServerEnvironment();
  const session = await auth();
  if (
    !session?.apiAccessToken ||
    session.error ||
    !session.user?.id ||
    !session.user.email
  ) {
    return "unavailable";
  }
  try {
    const response = await fetchWithoutRedirects(
      new URL("/v1/me", environment.API_BASE_URL),
      {
        method: "GET",
        headers: {
          accept: "application/json, application/problem+json",
          authorization: `Bearer ${session.apiAccessToken}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) {
      return "enrolled";
    }
    if (
      response.status === 403 &&
      environment.AUTH_SELF_REGISTRATION_ENABLED === "true" &&
      session.appRoles?.length === 1 &&
      session.appRoles[0] === "USER"
    ) {
      const problem = (await response.json()) as { code?: unknown };
      if (problem.code === "ACCOUNT_ENROLLMENT_REQUIRED") {
        return "enrollment-required";
      }
    }
  } catch {
    // No identity or provider error details are exposed to the browser.
  }
  return "unavailable";
}
