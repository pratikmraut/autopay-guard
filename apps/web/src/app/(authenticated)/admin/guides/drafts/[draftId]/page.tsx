import type { Metadata } from "next";

import { AdminGuideDraftScreen } from "@/components/admin-guide-draft-screen";

export const metadata: Metadata = {
  title: "Edit fictional guide draft",
};

export default async function AdminGuideDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <AdminGuideDraftScreen draftId={draftId} />;
}
