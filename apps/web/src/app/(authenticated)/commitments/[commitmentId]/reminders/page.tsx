import type { Metadata } from "next";

import { CommitmentReminderScreen } from "@/components/commitment-reminder-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Commitment reminders",
};

export default async function CommitmentReminderPage({
  params,
}: {
  params: Promise<{ commitmentId: string }>;
}) {
  const { commitmentId } = await params;
  return (
    <HouseholdScope>
      <CommitmentReminderScreen commitmentId={commitmentId} />
    </HouseholdScope>
  );
}
