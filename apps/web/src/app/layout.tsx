import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AutoPay Guard",
    template: "%s · AutoPay Guard",
  },
  description:
    "A privacy-first control center for recurring commitments in India.",
  applicationName: "AutoPay Guard",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
