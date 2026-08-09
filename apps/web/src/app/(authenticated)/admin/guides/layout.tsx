import { requireAppRole } from "@/lib/session";

export default async function GuideAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppRole("GUIDE_ADMIN", "/admin/guides");
  return children;
}
