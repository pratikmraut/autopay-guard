import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { TrustBanner } from "@/components/trust-banner";
import { beginRegistration } from "@/lib/account-registration";
import { getServerEnvironment } from "@/lib/env";
import { isLocalDemoLoginAvailable } from "@/lib/local-demo-login";
import { getOptionalSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  const environment = getServerEnvironment();
  const enabled = environment.AUTH_SELF_REGISTRATION_ENABLED === "true";
  const demoOnly = isLocalDemoLoginAvailable(environment) && !enabled;
  if (enabled && (await getOptionalSessionUser())) {
    redirect("/enroll");
  }

  return (
    <div className="public-page">
      <header className="public-header">
        <BrandMark />
        <Link className="secondary-link secondary-link--compact" href="/signin">
          Sign in
        </Link>
      </header>
      <main className="privacy-main" id="main-content">
        <div>
          <p className="eyebrow">
            {demoOnly
              ? "Existing demo account only"
              : "Your own account, your own workspace"}
          </p>
          <h1>
            {enabled ? "Create your account" : "Registration is not open"}
          </h1>
          <p className="privacy-lede">
            {enabled
              ? "Create and verify your identity with our sign-in provider, then review the notice before setting up your private workspace."
              : demoOnly
                ? "New accounts are disabled for this local demo. Use the existing demo username and password to access your saved workspace and its account features."
                : "You can explore the isolated demo without an account, or sign in with an existing account."}
          </p>
        </div>
        <TrustBanner />
        {enabled && (
          <section
            className="privacy-card"
            aria-labelledby="registration-details"
          >
            <h2 id="registration-details">Before you begin</h2>
            <p className="mt-4 leading-7 text-slate-600">
              AutoPay Guard does not receive your provider password. Use a
              unique password with the provider. Email verification and password
              recovery are handled there, not by this website.
            </p>
            {environment.AUTOPAY_GUARD_RUNTIME_MODE === "LOCAL" && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                Local rehearsal only: use a fictional email ending in
                @autopayguard.local. Verification and recovery messages go to
                local Mailpit, not a real inbox. Do not use real personal or
                financial data.
              </p>
            )}
            <form
              className="mt-6"
              action={async () => {
                "use server";
                await beginRegistration();
              }}
            >
              <button className="primary-link" type="submit">
                Create account securely
                <span aria-hidden="true">→</span>
              </button>
            </form>
          </section>
        )}
        <div className="flex flex-wrap gap-4">
          {demoOnly && (
            <Link className="primary-link" href="/signin">
              Open demo workspace
            </Link>
          )}
          <Link className="secondary-link" href="/demo">
            {demoOnly ? "Try a temporary sample" : "Try the demo"}
          </Link>
          <Link className="nav-text-link" href="/privacy">
            Read the privacy notice
          </Link>
        </div>
      </main>
    </div>
  );
}
