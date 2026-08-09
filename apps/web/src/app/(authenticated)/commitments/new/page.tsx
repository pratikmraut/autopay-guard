import type { Metadata } from "next";

import { CommitmentCreateScreen } from "@/components/commitment-create-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Add recurring commitment",
};

export default function NewCommitmentPage() {
  return (
    <HouseholdScope>
      <CommitmentCreateScreen />
    </HouseholdScope>
  );
}
