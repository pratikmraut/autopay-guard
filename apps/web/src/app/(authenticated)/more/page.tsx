import type { Metadata } from "next";
import Link from "next/link";

import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "More controls",
};

const userLinks = [
  {
    href: "/imports",
    title: "Controlled CSV import",
    description:
      "Upload one bounded template and review every private row before creation.",
  },
  {
    href: "/notifications",
    title: "Notification inbox",
    description: "Review safe in-app reminder delivery states.",
  },
  {
    href: "/settings/notifications",
    title: "Notification settings",
    description: "Control explicit reminder consent and rule sets.",
  },
  {
    href: "/household",
    title: "Household and invitations",
    description: "Manage fake-local membership and selected sharing.",
  },
  {
    href: "/settings/privacy",
    title: "Privacy controls",
    description: "Notice, consent, export, correction, and deletion requests.",
  },
  {
    href: "/settings/support",
    title: "Support access",
    description: "Generate a short-lived redacted-diagnostics code.",
  },
] as const;

const staffLinks = [
  {
    role: "GUIDE_ADMIN",
    href: "/admin/guides",
    title: "Guide administration",
    description: "Draft and publish fictional cancellation guidance.",
  },
  {
    role: "PRIVACY_ADMIN",
    href: "/admin/privacy",
    title: "Privacy request queue",
    description: "Execute bounded fake-local privacy operations.",
  },
  {
    role: "AUDIT_READ",
    href: "/admin/audit",
    title: "Local application audit",
    description: "Read append-only allowlisted audit metadata.",
  },
  {
    role: "SUPPORT_READ",
    href: "/support/diagnostics",
    title: "Support diagnostics",
    description: "Resolve one owner-authorized redacted code.",
  },
] as const;

export default async function MorePage() {
  const user = await requireSessionUser("/more");
  const links = [
    ...(user.roles.includes("USER") ? userLinks : []),
    ...staffLinks.filter((link) => user.roles.includes(link.role)),
  ];

  return (
    <div className="notification-settings-page">
      <header className="resource-heading">
        <div>
          <p className="eyebrow">Settings and bounded operations</p>
          <h1>More controls</h1>
          <p>
            Open only the areas granted to this signed-in fake-local role. The
            API remains the authorization authority.
          </p>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {links.map((link) => (
          <Link
            className="notification-settings-card transition hover:-translate-y-0.5 hover:border-emerald-900/25"
            href={link.href}
            key={link.href}
          >
            <h2 className="text-2xl font-black text-emerald-950">
              {link.title}
            </h2>
            <p className="mt-3 leading-6 text-slate-600">{link.description}</p>
            <span className="mt-5 inline-flex font-black text-emerald-800">
              Open <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
