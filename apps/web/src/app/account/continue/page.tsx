import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { accountStatus } from "@/lib/account-registration";
import { signOutUser } from "@/lib/provider-signout";
import { safeReturnTo } from "@/lib/safe-return-to";
import { requireSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Continue to your account" };

export default async function AccountContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const callbackUrl = safeReturnTo((await searchParams).callbackUrl);
  await requireSessionUser(callbackUrl);
  const status = await accountStatus();
  if (status === "enrolled") {
    redirect(callbackUrl === "/enroll" ? "/onboarding" : callbackUrl);
  }
  if (status === "enrollment-required") {
    redirect("/enroll");
  }

  return (
    <main className="privacy-main" id="main-content">
      <BrandMark />
      <h1>Account access is unavailable</h1>
      <p className="privacy-lede">
        We could not confirm access to your application account. Your identity
        may need verification, access may be restricted, or the service may be
        temporarily unavailable. No account was created here.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          className="secondary-link"
          href={`/account/continue?callbackUrl=${encodeURIComponent(callbackUrl)}`}
        >
          Try again
        </Link>
        <form
          action={async () => {
            "use server";
            await signOutUser();
          }}
        >
          <button className="primary-link" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
