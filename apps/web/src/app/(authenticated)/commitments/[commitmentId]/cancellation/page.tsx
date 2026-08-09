import type { Metadata } from "next";

import { CancellationGuideScreen } from "@/components/cancellation-guide-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Cancellation guide",
};

export default async function CancellationGuidePage({
  params,
}: {
  params: Promise<{ commitmentId: string }>;
}) {
  const { commitmentId } = await params;
  return (
    <HouseholdScope>
      <CancellationGuideScreen commitmentId={commitmentId} />
    </HouseholdScope>
  );
}
