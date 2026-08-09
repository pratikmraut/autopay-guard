import type { Metadata } from "next";

import { AdminPrivacyQueueScreen } from "@/components/admin-privacy-queue-screen";

export const metadata: Metadata = {
  title: "Privacy request queue",
};

export default function AdminPrivacyQueuePage() {
  return <AdminPrivacyQueueScreen />;
}
