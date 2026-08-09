import type { DefaultSession } from "next-auth";
import type { AppRole } from "@/lib/app-roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    error?: "RefreshAccessTokenError";
    apiAccessToken?: string;
    providerRefreshToken?: string;
    appRoles?: AppRole[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    apiAccessToken?: string;
    accessTokenExpiresAt?: number;
    refreshToken?: string;
    idToken?: string;
    authError?: "RefreshAccessTokenError";
    appRoles?: AppRole[];
  }
}
