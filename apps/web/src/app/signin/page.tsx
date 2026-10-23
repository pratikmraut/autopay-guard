import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { TrustBanner } from "@/components/trust-banner";
import { accountContinuationUrl } from "@/lib/account-registration";
import { getServerEnvironment } from "@/lib/env";
import {
  beginLocalDemoLogin,
  isLocalDemoLoginAvailable,
  LOCAL_DEMO_USERNAME,
} from "@/lib/local-demo-login";
import { safeReturnTo } from "@/lib/safe-return-to";
import { getOptionalSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

interface SignInPageProps {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
    recovery?: string | string[];
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const parameters = await searchParams;
  const callbackUrl = safeReturnTo(parameters.callbackUrl);
  const authError = typeof parameters.error === "string";
  const recovery = parameters.recovery === "1";
  const environment = getServerEnvironment();
  const registrationEnabled =
    environment.AUTH_SELF_REGISTRATION_ENABLED === "true";
  const localDemoEnabled = isLocalDemoLoginAvailable(environment);
  const demoOnly = localDemoEnabled && !registrationEnabled;
  const user = await getOptionalSessionUser();

  if (user) {
    redirect(accountContinuationUrl(callbackUrl));
  }

  return (
    <main className="signin-page" id="main-content">
      <section className="signin-story" aria-label="AutoPay Guard introduction">
        <BrandMark />
        <div className="max-w-xl">
          <p className="eyebrow eyebrow--light">
            Your recurring-money control room
          </p>
          <h1>Clarity before the next debit.</h1>
          <p>
            {demoOnly
              ? "Return to your saved demo workspace for recurring commitments, reminders, decisions, savings and imports. Use fictional data only."
              : "Sign in to create a private workspace for the recurring commitments you choose to track."}
          </p>
        </div>
        <div className="signin-quote">
          <span aria-hidden="true">“</span>
          <p>
            Know every recurring rupee before it leaves. The final decision
            remains yours.
          </p>
        </div>
      </section>

      <section className="signin-panel" aria-labelledby="signin-title">
        <div className="w-full max-w-md">
          <p className="eyebrow">Secure access</p>
          <h2 id="signin-title">Sign in to AutoPay Guard</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Continue through our sign-in provider. Your provider password is
            never sent to AutoPay Guard.
          </p>

          {recovery && (
            <p
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
              role="status"
            >
              Select Continue securely, then choose “Forgot password?” on the
              provider page. Follow the email link there to reset your password.
              {environment.AUTOPAY_GUARD_RUNTIME_MODE === "LOCAL" &&
                " In this local rehearsal, messages are captured in Mailpit, not delivered to a real inbox."}
            </p>
          )}

          {authError && (
            <div
              className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              role="alert"
            >
              Sign-in did not complete. Please try again.
            </div>
          )}

          {localDemoEnabled && (
            <LocalDemoSignIn callbackUrl={callbackUrl} demoOnly={demoOnly} />
          )}

          <form
            action={async () => {
              "use server";
              getServerEnvironment();
              await signIn("keycloak", {
                redirectTo: accountContinuationUrl(callbackUrl),
              });
            }}
            className="mt-8"
          >
            <button className="oidc-signin-button" type="submit">
              <span aria-hidden="true" className="oidc-signin-button__mark">
                K
              </span>
              Continue securely
              <span aria-hidden="true" className="ml-auto">
                →
              </span>
            </button>
          </form>

          <div className="mt-5 flex flex-wrap justify-between gap-4 text-sm">
            {registrationEnabled && (
              <Link
                className="font-bold text-emerald-800 underline"
                href="/signup"
              >
                Create account
              </Link>
            )}
            <Link
              className="font-bold text-emerald-800 underline"
              href="/signin?recovery=1"
            >
              Forgot password?
            </Link>
          </div>

          <p className="mt-5 text-center text-sm">
            <Link
              className="inline-flex min-h-11 items-center font-bold text-emerald-800 underline underline-offset-4"
              href="/demo"
            >
              Try sample without signing in
            </Link>
            <span className="block text-xs leading-5 text-slate-600">
              Isolated sample data. Changes reset on refresh.
            </span>
          </p>

          <div className="mt-8">
            <TrustBanner />
          </div>

          <p className="mt-7 text-center text-xs leading-5 text-slate-500">
            {demoOnly
              ? "This is a local demonstration, not an open registration service."
              : "By continuing, you can review the notice before creating a workspace."}{" "}
            <Link
              className="font-bold text-emerald-800 underline"
              href="/privacy"
            >
              Privacy details
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function LocalDemoSignIn({
  callbackUrl,
  demoOnly,
}: {
  callbackUrl: string;
  demoOnly: boolean;
}) {
  return (
    <section
      className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
      aria-labelledby="local-demo-title"
    >
      <p className="eyebrow">Local demo account</p>
      <h3
        id="local-demo-title"
        className="mt-2 text-lg font-extrabold text-emerald-950"
      >
        {demoOnly ? "Your saved demo workspace" : "Explore the full local app"}
      </h3>
      <p className="mt-2 break-all text-sm font-bold text-emerald-950">
        {LOCAL_DEMO_USERNAME}
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        We preselect the demo email. Enter the existing local demo password on
        the Keycloak page to continue. Your changes are saved in the local demo
        workspace; use fictional data only.
      </p>
      {demoOnly && (
        <p className="mt-3 text-sm font-bold leading-6 text-emerald-950">
          No new account is needed. Registration is closed.
        </p>
      )}
      <form
        className="mt-4"
        action={async () => {
          "use server";
          await beginLocalDemoLogin(callbackUrl);
        }}
      >
        <button
          className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl bg-emerald-950 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
          type="submit"
        >
          Use local demo account
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </section>
  );
}
