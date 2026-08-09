import type { Metadata } from "next";

import { OnboardingForm } from "@/components/onboarding-form";
import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Workspace setup",
};

export default async function OnboardingPage() {
  const user = await requireSessionUser("/onboarding");
  const firstName = user.name.split(/\s+/)[0] || "My";

  return (
    <div className="onboarding-page">
      <header className="onboarding-heading">
        <p className="eyebrow">A private place to begin</p>
        <h1>Create your workspace</h1>
        <p>
          Give your control room a familiar name and confirm the two essentials
          below. You can change workspace details later.
        </p>
      </header>

      <div className="onboarding-grid">
        <aside className="setup-steps" aria-label="Setup progress">
          <p className="card-kicker">Setup progress</p>
          <ol>
            <li className="is-complete">
              <span aria-hidden="true">✓</span>
              <p>
                <strong>Secure sign-in</strong>
                <small>Identity confirmed</small>
              </p>
            </li>
            <li className="is-current" aria-current="step">
              <span aria-hidden="true">2</span>
              <p>
                <strong>Your workspace</strong>
                <small>Name and consent</small>
              </p>
            </li>
            <li>
              <span aria-hidden="true">3</span>
              <p>
                <strong>Recurring commitments</strong>
                <small>Your next guided step</small>
              </p>
            </li>
          </ol>
        </aside>

        <section
          className="onboarding-card"
          aria-labelledby="workspace-details"
        >
          <div className="mb-7">
            <p className="card-kicker">Step 2 of 3</p>
            <h2 id="workspace-details">Workspace details</h2>
          </div>
          <OnboardingForm defaultName={`${firstName}'s workspace`} />
        </section>
      </div>
    </div>
  );
}
