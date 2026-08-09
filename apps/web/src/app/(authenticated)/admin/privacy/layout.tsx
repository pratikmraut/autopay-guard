import { requireAppRole } from "@/lib/session";

export default async function PrivacyAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppRole("PRIVACY_ADMIN", "/admin/privacy");
  return children;
}
