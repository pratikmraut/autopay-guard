import "server-only";

import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { getServerEnvironment } from "@/lib/env";
import type { AppRole } from "@/lib/app-roles";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roles: AppRole[];
}

export async function getOptionalSessionUser(): Promise<SessionUser | null> {
  getServerEnvironment();
  const session = await auth();
  if (
    session?.error === "RefreshAccessTokenError" ||
    !session?.user?.id ||
    !session.user.email
  ) {
    return null;
  }

  return {
    id: session.user.id,
    name: session.user.name?.trim() || session.user.email,
    email: session.user.email,
    roles: session.appRoles ?? [],
  };
}

export async function requireSessionUser(
  returnTo = "/dashboard",
): Promise<SessionUser> {
  const user = await getOptionalSessionUser();
  if (!user) {
    const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard";
    redirect(`/signin?callbackUrl=${encodeURIComponent(safeReturnTo)}`);
  }
  return user;
}

export async function requireAppRole(
  role: AppRole,
  returnTo: string,
): Promise<SessionUser> {
  const user = await requireSessionUser(returnTo);
  if (!user.roles.includes(role)) {
    notFound();
  }
  return user;
}
