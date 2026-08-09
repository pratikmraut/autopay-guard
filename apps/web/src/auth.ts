import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import type { JWT } from "next-auth/jwt";

import { getAuthBuildEnvironment, getServerEnvironment } from "@/lib/env";
import { extractAppClientRoles } from "@/lib/app-roles";
import { fetchWithoutRedirects } from "@/lib/outbound-fetch";

const buildEnvironment = getAuthBuildEnvironment();

export const AUTH_SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Secure-autopay-guard.session-token"
    : "autopay-guard.session-token";

export const { auth, handlers, signIn, signOut } = NextAuth({
  secret: buildEnvironment.secret,
  trustHost: buildEnvironment.trustHost,
  providers: [
    Keycloak({
      clientId: buildEnvironment.clientId,
      clientSecret: buildEnvironment.clientSecret,
      issuer: buildEnvironment.publicIssuer,
      wellKnown: `${buildEnvironment.internalIssuer}/.well-known/openid-configuration`,
      authorization: {
        url: `${buildEnvironment.publicIssuer}/protocol/openid-connect/auth`,
        params: {
          scope: "openid profile email",
        },
      },
      token: `${buildEnvironment.internalIssuer}/protocol/openid-connect/token`,
      userinfo: `${buildEnvironment.internalIssuer}/protocol/openid-connect/userinfo`,
      checks: ["pkce", "state", "nonce"],
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
    updateAge: 15 * 60,
  },
  cookies: {
    sessionToken: {
      name: AUTH_SESSION_COOKIE,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.apiAccessToken = account.access_token;
        token.appRoles = extractAppClientRoles(account.access_token);
        token.refreshToken = account.refresh_token;
        token.idToken = account.id_token;
        token.accessTokenExpiresAt = account.expires_at
          ? account.expires_at * 1_000
          : Date.now() + 5 * 60 * 1_000;
        delete token.authError;
        return token;
      }

      if (
        token.apiAccessToken &&
        token.accessTokenExpiresAt &&
        Date.now() < token.accessTokenExpiresAt - 60_000
      ) {
        return token;
      }

      if (!token.refreshToken) {
        token.authError = "RefreshAccessTokenError";
        return token;
      }

      return refreshAccessToken(token);
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
      }
      if (token.authError) {
        session.error = token.authError;
      }
      // These fields are consumed only by server-side auth()/BFF handlers.
      // /api/auth/session is disabled below so they cannot become browser JSON.
      session.apiAccessToken = token.apiAccessToken;
      session.providerRefreshToken = token.refreshToken;
      session.appRoles = token.appRoles ?? [];
      return session;
    },
  },
});

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const environment = getServerEnvironment();
    const tokenIssuer =
      environment.AUTH_KEYCLOAK_INTERNAL_ISSUER ??
      environment.AUTH_KEYCLOAK_ISSUER;
    const response = await fetchWithoutRedirects(
      `${tokenIssuer}/protocol/openid-connect/token`,
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: environment.AUTH_KEYCLOAK_ID,
          client_secret: environment.AUTH_KEYCLOAK_SECRET,
          grant_type: "refresh_token",
          refresh_token: token.refreshToken ?? "",
        }),
      },
    );

    if (!response.ok) {
      throw new Error("OIDC token refresh was rejected.");
    }

    const refreshed = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    return {
      ...token,
      apiAccessToken: refreshed.access_token,
      appRoles: extractAppClientRoles(refreshed.access_token),
      accessTokenExpiresAt: Date.now() + refreshed.expires_in * 1_000,
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      authError: undefined,
    };
  } catch {
    return {
      ...token,
      authError: "RefreshAccessTokenError",
    };
  }
}
