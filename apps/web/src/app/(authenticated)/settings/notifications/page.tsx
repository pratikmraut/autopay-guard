import type { Metadata } from "next";

import { HouseholdScope } from "@/components/household-scope";
import { NotificationSettingsScreen } from "@/components/notification-settings-screen";

export const metadata: Metadata = {
  title: "Notification settings",
};

export default function NotificationSettingsPage() {
  return (
    <HouseholdScope>
      <NotificationSettingsScreen />
    </HouseholdScope>
  );
}
