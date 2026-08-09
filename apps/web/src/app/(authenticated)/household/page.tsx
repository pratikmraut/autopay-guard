import type { Metadata } from "next";

import { HouseholdHubScreen } from "@/components/household-hub-screen";

export const metadata: Metadata = {
  title: "Household access",
};

export default function HouseholdPage() {
  return <HouseholdHubScreen />;
}
