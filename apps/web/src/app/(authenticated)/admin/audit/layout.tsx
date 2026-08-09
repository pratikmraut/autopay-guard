import { requireAppRole } from "@/lib/session";

export default async function AuditReaderLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppRole("AUDIT_READ", "/admin/audit");
  return children;
}
