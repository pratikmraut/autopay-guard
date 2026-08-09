import type { Metadata } from "next";

import { CommitmentListScreen } from "@/components/commitment-list-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Recurring commitments",
};

export default function CommitmentsPage() {
  return (
    <HouseholdScope>
      <CommitmentListScreen />
    </HouseholdScope>
  );
}
