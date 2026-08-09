import type { Metadata } from "next";

import { CancellationAttemptScreen } from "@/components/cancellation-attempt-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Cancellation attempt",
};

export default async function CancellationAttemptPage({
  params,
}: {
  params: Promise<{ commitmentId: string; attemptId: string }>;
}) {
  const { commitmentId, attemptId } = await params;
  return (
    <HouseholdScope>
      <CancellationAttemptScreen
        attemptId={attemptId}
        commitmentId={commitmentId}
      />
    </HouseholdScope>
  );
}
