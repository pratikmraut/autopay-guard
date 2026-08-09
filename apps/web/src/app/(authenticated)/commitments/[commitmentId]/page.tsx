import type { Metadata } from "next";

import { CommitmentDetailScreen } from "@/components/commitment-detail-screen";
import { HouseholdScope } from "@/components/household-scope";

export const metadata: Metadata = {
  title: "Commitment details",
};

export default async function CommitmentDetailPage({
  params,
}: {
  params: Promise<{ commitmentId: string }>;
}) {
  const { commitmentId } = await params;
  return (
    <HouseholdScope>
      <CommitmentDetailScreen commitmentId={commitmentId} />
    </HouseholdScope>
  );
}
