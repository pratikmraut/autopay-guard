import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { NotificationDetailScreen } from "@/components/notification-detail-screen";

export const metadata: Metadata = {
  title: "Notification details",
};

export default async function NotificationDetailPage({
  params,
}: {
  params: Promise<{ notificationId: string }>;
}) {
  const { notificationId } = await params;
  return (
    <HouseholdScope>
      <NotificationDetailScreen notificationId={notificationId} />
    </HouseholdScope>
  );
}
