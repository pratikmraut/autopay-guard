import type { Metadata } from "next";

import { DashboardScreen } from "@/components/dashboard-screen";
import { HouseholdScope } from "@/components/household-scope";
import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Dashboard",
};

interface DashboardPageProps {
  searchParams: Promise<{ onboarded?: string }>;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const [user, parameters] = await Promise.all([
    requireSessionUser("/dashboard"),
    searchParams,
  ]);
  const firstName = user.name.split(/\s+/)[0] || "there";

  return (
    <HouseholdScope>
      <DashboardScreen
        firstName={firstName}
        onboarded={parameters.onboarded === "1"}
      />
    </HouseholdScope>
  );
}
