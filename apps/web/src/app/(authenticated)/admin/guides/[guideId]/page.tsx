import type { Metadata } from "next";

import { AdminGuideDetailScreen } from "@/components/admin-guide-detail-screen";

export const metadata: Metadata = {
  title: "Fictional guide history",
};

export default async function AdminGuideDetailPage({
  params,
}: {
  params: Promise<{ guideId: string }>;
}) {
  const { guideId } = await params;
  return <AdminGuideDetailScreen guideId={guideId} />;
}
