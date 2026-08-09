import { requireAppRole } from "@/lib/session";

export default async function SupportReaderLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAppRole("SUPPORT_READ", "/support/diagnostics");
  return children;
}
