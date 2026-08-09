import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { TrustBanner } from "@/components/trust-banner";

export const metadata: Metadata = {
  title: "Privacy notice",
};

const boundaries = [
  "We do not ask for or store a UPI PIN, bank password, OTP, full card number, full bank account number, or full UPI ID.",
  "We do not initiate payments, move money, or directly revoke a payment mandate.",
  "The Foundation release uses only your sign-in identity and the workspace details you choose to provide.",
  "Authentication tokens remain in a secure, HttpOnly session and are not placed in browser local storage.",
] as const;

export default function PrivacyPage() {
  return (
    <div className="public-page">
      <header className="public-header">
        <BrandMark />
        <Link className="secondary-link secondary-link--compact" href="/">
          Back home
        </Link>
      </header>

      <main className="privacy-main" id="main-content">
        <div>
          <p className="eyebrow">Foundation privacy notice · version 1</p>
          <h1>Less data. Clear boundaries.</h1>
          <p className="privacy-lede">
            AutoPay Guard is being designed as a non-transactional recurring
            money control center. This notice describes the current Foundation
            release; it is a product design statement, not a claim of legal
            certification.
          </p>
        </div>

        <TrustBanner />

        <section className="privacy-card" aria-labelledby="what-we-do-not-do">
          <h2 id="what-we-do-not-do">What we do—and do not—handle</h2>
          <ul>
            {boundaries.map((boundary) => (
              <li key={boundary}>
                <span aria-hidden="true">✓</span>
                <p>{boundary}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="privacy-small-card">
            <p className="card-kicker">Your control</p>
            <h2>Consent is explicit</h2>
            <p>
              During setup, you confirm that you are 18 or older and accept this
              version of the notice before a workspace is created.
            </p>
          </article>
          <article className="privacy-small-card">
            <p className="card-kicker">Current scope</p>
            <h2>Fake development data only</h2>
            <p>
              The local Foundation environment is for seeded, fictional
              identities and data. Do not enter real financial information.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}
