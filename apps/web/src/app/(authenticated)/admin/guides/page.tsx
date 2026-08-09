import type { Metadata } from "next";

import { AdminGuideCatalogScreen } from "@/components/admin-guide-catalog-screen";

export const metadata: Metadata = {
  title: "Fictional guide administration",
};

export default function AdminGuidesPage() {
  return <AdminGuideCatalogScreen />;
}
