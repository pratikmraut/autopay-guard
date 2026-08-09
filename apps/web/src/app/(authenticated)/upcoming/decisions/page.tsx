import type { Metadata } from "next";

import { DecisionInboxScreen } from "@/components/decision-inbox-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Decision inbox",
};

export default function DecisionInboxPage() {
  return (
    <HouseholdScope>
      <DecisionInboxScreen />
    </HouseholdScope>
  );
}
