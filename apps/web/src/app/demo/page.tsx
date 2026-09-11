import type { Metadata } from "next";

import { DemoWorkspace } from "@/components/demo-workspace";

export const metadata: Metadata = {
  title: "Interactive sample demo | AutoPay Guard",
  description:
    "Try recurring commitment tracking with fictional sample data. No registration, bank connection, or payments.",
};

export default function DemoPage() {
  return <DemoWorkspace />;
}
