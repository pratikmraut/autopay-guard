import type { Metadata } from "next";

import { AdminAuditScreen } from "@/components/admin-audit-screen";

export const metadata: Metadata = {
  title: "Local application audit",
};

export default function AdminAuditPage() {
  return <AdminAuditScreen />;
}
