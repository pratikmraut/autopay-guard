import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { TrustBanner } from "@/components/trust-banner";

const controls = [
  {
    number: "01",
    title: "See what is recurring",
    body: "Bring subscriptions and recurring obligations into one clear workspace.",
  },
  {
    number: "02",
    title: "Decide before debit",
    body: "Review upcoming charges with enough time to keep, pause, or act.",
  },
  {
    number: "03",
    title: "Keep proof of action",
    body: "Track service cancellation and payment-mandate steps separately.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="public-page">
      <header className="public-header">
        <BrandMark />
        <nav aria-label="Public navigation" className="flex items-center gap-2">
          <Link className="nav-text-link" href="/privacy">
            Privacy
          </Link>
          <Link className="primary-link" href="/signin">
            Sign in
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Recurring money, made visible</p>
            <h1>
              Every recurring rupee,{" "}
              <span className="headline-accent">under your watch.</span>
            </h1>
            <p className="hero-lede">
              Know what may debit next, decide what deserves your money, and
              keep a clear record of every action.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="primary-link primary-link--large" href="/signin">
                Open your control room
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="secondary-link" href="/privacy">
                Read our privacy promise
              </Link>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-500">
              For adults 18+ in India. AutoPay Guard does not initiate payments.
            </p>
          </div>

          <div
            className="hero-control-card"
            aria-label="How AutoPay Guard works"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-extrabold tracking-[0.15em] text-emerald-800 uppercase">
                  Your control loop
                </p>
                <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em] text-slate-950">
                  Know. Decide. Verify.
                </h2>
              </div>
              <span className="status-pill">
                <i aria-hidden="true" />
                Private
              </span>
            </div>

            <ol className="mt-8 grid gap-3">
              {controls.map((control) => (
                <li className="control-step" key={control.number}>
                  <span aria-hidden="true">{control.number}</span>
                  <div>
                    <h3>{control.title}</h3>
                    <p>{control.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="control-card-footer">
              <span aria-hidden="true" className="text-xl">
                ₹
              </span>
              <p>
                <strong>Your money stays yours.</strong>
                <br />
                The final action always happens with you.
              </p>
            </div>
          </div>
        </section>

        <div className="public-trust-wrap">
          <TrustBanner />
        </div>
      </main>

      <footer className="public-footer">
        <p>AutoPay Guard is a working name for a private beta product.</p>
        <p>Built for clarity, consent, and user control.</p>
      </footer>
    </div>
  );
}
