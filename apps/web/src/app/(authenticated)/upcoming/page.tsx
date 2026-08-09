import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { UpcomingScreen } from "@/components/upcoming-screen";

export const metadata: Metadata = {
  title: "Upcoming commitments",
};

export default function UpcomingPage() {
  return (
    <HouseholdScope>
      <UpcomingScreen />
    </HouseholdScope>
  );
}
