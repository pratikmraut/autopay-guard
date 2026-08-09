import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { SupportCodeScreen } from "@/components/support-code-screen";

export const metadata: Metadata = {
  title: "Support access",
};

export default function SupportSettingsPage() {
  return (
    <HouseholdScope>
      <SupportCodeScreen />
    </HouseholdScope>
  );
}
