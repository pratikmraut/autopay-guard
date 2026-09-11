import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AccountEnrollmentForm } from "@/components/account-enrollment-form";
import { accountStatus } from "@/lib/account-registration";
import { getServerEnvironment } from "@/lib/env";
import { requireAppRole } from "@/lib/session";

export const metadata: Metadata = { title: "Finish account setup" };

export default async function EnrollPage() {
  const environment = getServerEnvironment();
  if (environment.AUTH_SELF_REGISTRATION_ENABLED !== "true") {
    notFound();
  }
  const user = await requireAppRole("USER", "/enroll");
  if (user.roles.length !== 1) {
    notFound();
  }
  const status = await accountStatus();
  if (status === "enrolled") {
    redirect("/onboarding");
  }
  if (status !== "enrollment-required") {
    redirect("/account/continue");
  }

  return (
    <div className="onboarding-page">
      <header className="onboarding-heading">
        <p className="eyebrow">Identity verified · Account setup</p>
        <h1>Finish creating your account</h1>
        <p>
          Signed in as {user.email}. Review the notice and confirm below. Your
          application account is created only when you submit this form.
        </p>
      </header>
      <section className="onboarding-card" aria-label="Account consent">
        {environment.AUTOPAY_GUARD_RUNTIME_MODE === "LOCAL" && (
          <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Local rehearsal: use fictional identity and commitment data only.
            This is not a production service.
          </p>
        )}
        <AccountEnrollmentForm />
      </section>
    </div>
  );
}
