import "server-only";

import { signIn } from "@/auth";
import { accountContinuationUrl } from "@/lib/account-registration";
import { getServerEnvironment, type ServerEnvironment } from "@/lib/env";

export const LOCAL_DEMO_USERNAME = "demo@autopayguard.local";

type LocalDemoEnvironment = Pick<
  ServerEnvironment,
  "AUTOPAY_GUARD_RUNTIME_MODE" | "AUTH_URL" | "AUTH_KEYCLOAK_ISSUER"
>;

export function isLocalDemoLoginAvailable(environment: LocalDemoEnvironment) {
  return (
    environment.AUTOPAY_GUARD_RUNTIME_MODE === "LOCAL" &&
    environment.AUTH_URL === "http://localhost:3000" &&
    environment.AUTH_KEYCLOAK_ISSUER ===
      "http://localhost:8081/realms/autopay-guard"
  );
}

export async function beginLocalDemoLogin(callbackUrl?: string | string[]) {
  // Recheck on every server action; hiding the card is not an access boundary.
  if (!isLocalDemoLoginAvailable(getServerEnvironment())) {
    throw new Error("Local demo account sign-in is not available.");
  }

  // This is only a username hint, never an authentication bypass. Keycloak
  // still requires the existing local password and the normal OIDC checks.
  // Force a fresh prompt so another existing provider session cannot be reused.
  await signIn(
    "keycloak",
    { redirectTo: accountContinuationUrl(callbackUrl) },
    { login_hint: LOCAL_DEMO_USERNAME, prompt: "login" },
  );
}
