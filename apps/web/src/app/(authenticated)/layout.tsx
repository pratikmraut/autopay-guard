import { AppShell } from "@/components/app-shell";
import { requireSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSessionUser();

  return <AppShell user={user}>{children}</AppShell>;
}
