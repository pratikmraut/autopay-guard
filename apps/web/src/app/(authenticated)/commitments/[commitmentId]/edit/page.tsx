import type { Metadata } from "next";

import { CommitmentEditScreen } from "@/components/commitment-edit-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Edit recurring commitment",
};

export default async function EditCommitmentPage({
  params,
}: {
  params: Promise<{ commitmentId: string }>;
}) {
  const { commitmentId } = await params;
  return (
    <HouseholdScope>
      <CommitmentEditScreen commitmentId={commitmentId} />
    </HouseholdScope>
  );
}
