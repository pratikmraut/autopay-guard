import Link from "next/link";

import { AppNavigation } from "@/components/app-navigation";
import { BrandMark } from "@/components/brand-mark";
import { TrustBanner } from "@/components/trust-banner";
import { signOutUser } from "@/lib/provider-signout";
import type { SessionUser } from "@/lib/session";

interface AppShellProps {
  user: SessionUser;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const initial = user.name.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="app-sidebar" aria-label="Primary navigation">
        <BrandMark />
        <div className="mt-10">
          <p className="mb-3 px-3 text-[0.68rem] font-extrabold tracking-[0.16em] text-slate-600 uppercase">
            Your control room
          </p>
          <AppNavigation roles={user.roles} />
        </div>

        <div className="mt-auto rounded-2xl border border-emerald-900/10 bg-emerald-50 p-4">
          <p className="text-xs font-extrabold tracking-[0.12em] text-emerald-900 uppercase">
            Private by design
          </p>
          <p className="mt-2 text-sm leading-6 text-emerald-950/75">
            You stay in control. AutoPay Guard does not move money or revoke
            mandates.
          </p>
        </div>
        <Link className="sidebar-setup-link" href="/onboarding">
          Workspace setup
          <span aria-hidden="true">→</span>
        </Link>
      </aside>

      <div className="app-workspace">
        <header className="app-header">
          <div className="md:hidden">
            <BrandMark compact />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold text-slate-950">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-full bg-amber-200 text-sm font-black text-amber-950"
            >
              {initial}
            </span>
            <form
              action={async () => {
                "use server";
                await signOutUser();
              }}
            >
              <button className="header-action" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        <div className="px-4 pt-4 sm:px-6 lg:px-10">
          <TrustBanner />
        </div>
        <main className="app-main" id="main-content">
          {children}
        </main>

        <AppNavigation mobile roles={user.roles} />
      </div>
    </div>
  );
}
