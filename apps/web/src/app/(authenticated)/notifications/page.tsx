import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { NotificationInboxScreen } from "@/components/notification-inbox-screen";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <HouseholdScope>
      <NotificationInboxScreen />
    </HouseholdScope>
  );
}
