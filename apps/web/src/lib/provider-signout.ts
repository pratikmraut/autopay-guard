import "server-only";

import { auth, signOut } from "@/auth";
import { getServerEnvironment } from "@/lib/env";
import { fetchWithoutRedirects } from "@/lib/outbound-fetch";

export async function signOutUser() {
  const environment = getServerEnvironment();
  const session = await auth();

  if (session?.providerRefreshToken) {
    const issuer =
      environment.AUTH_KEYCLOAK_INTERNAL_ISSUER ??
      environment.AUTH_KEYCLOAK_ISSUER;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      await fetchWithoutRedirects(`${issuer}/protocol/openid-connect/logout`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: environment.AUTH_KEYCLOAK_ID,
          client_secret: environment.AUTH_KEYCLOAK_SECRET,
          refresh_token: session.providerRefreshToken,
        }),
        signal: controller.signal,
      });
    } catch {
      // Local sign-out must still complete if the development IdP is down.
    } finally {
      clearTimeout(timeout);
    }
  }

  await signOut({ redirectTo: "/" });
}
