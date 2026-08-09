"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { AppRole } from "@/lib/app-roles";

const navigation = [
  { href: "/dashboard", label: "Dashboard", symbol: "⌂" },
  { href: "/commitments", label: "Commitments", symbol: "₹" },
  { href: "/imports", label: "Import CSV", symbol: "CSV" },
  { href: "/upcoming", label: "Upcoming", symbol: "□" },
  { href: "/notifications", label: "Notifications", symbol: "○" },
  { href: "/household", label: "Household", symbol: "H" },
  { href: "/more", label: "More", symbol: "•••" },
] as const;

const staffNavigation: ReadonlyArray<{
  href: string;
  label: string;
  symbol: string;
  role: AppRole;
}> = [
  {
    href: "/admin/guides",
    label: "Guide admin",
    symbol: "G",
    role: "GUIDE_ADMIN",
  },
  {
    href: "/admin/privacy",
    label: "Privacy queue",
    symbol: "P",
    role: "PRIVACY_ADMIN",
  },
  {
    href: "/admin/audit",
    label: "Local audit",
    symbol: "A",
    role: "AUDIT_READ",
  },
  {
    href: "/support/diagnostics",
    label: "Support diagnostics",
    symbol: "S",
    role: "SUPPORT_READ",
  },
] as const;

interface AppNavigationProps {
  mobile?: boolean;
  roles: AppRole[];
}

export function AppNavigation({ mobile = false, roles }: AppNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const householdId = searchParams.get("householdId");
  const userNavigation = roles.includes("USER")
    ? mobile
      ? navigation.filter((item) =>
          ["/dashboard", "/commitments", "/upcoming", "/more"].includes(
            item.href,
          ),
        )
      : navigation
    : [];
  const visibleNavigation = [
    ...userNavigation,
    ...staffNavigation.filter((item) => roles.includes(item.role)),
  ];

  return (
    <nav
      className={mobile ? "mobile-navigation" : "grid gap-1.5"}
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
    >
      {visibleNavigation.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={mobile ? undefined : "sidebar-link"}
            href={
              householdId
                ? `${item.href}?householdId=${encodeURIComponent(householdId)}`
                : item.href
            }
            key={item.href}
          >
            <span
              aria-hidden="true"
              className={mobile ? undefined : "sidebar-link__symbol"}
            >
              {item.symbol}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
