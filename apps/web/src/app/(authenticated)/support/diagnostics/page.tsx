import type { Metadata } from "next";

import { SupportDiagnosticsScreen } from "@/components/support-diagnostics-screen";

export const metadata: Metadata = {
  title: "Support diagnostics",
};

export default function SupportDiagnosticsPage() {
  return <SupportDiagnosticsScreen />;
}
