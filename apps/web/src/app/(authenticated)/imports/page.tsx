import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { ImportScreen } from "@/components/import-screen";

export const metadata: Metadata = {
  title: "Controlled CSV import",
};

export default function ImportsPage() {
  return (
    <HouseholdScope>
      <ImportScreen />
    </HouseholdScope>
  );
}
