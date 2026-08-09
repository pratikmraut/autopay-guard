import type { Metadata } from "next";

import { PrivacyControlScreen } from "@/components/privacy-control-screen";

export const metadata: Metadata = {
  title: "Privacy controls",
};

export default function PrivacySettingsPage() {
  return <PrivacyControlScreen />;
}
