import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { SavingsDashboardScreen } from "@/components/savings-dashboard-screen";

export const metadata: Metadata = {
  title: "Honest savings",
};

export default function SavingsDashboardPage() {
  return (
    <HouseholdScope>
      <SavingsDashboardScreen />
    </HouseholdScope>
  );
}
