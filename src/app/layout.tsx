import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-context";

export const metadata: Metadata = {
  title: { default: "Solar Warehouse", template: "%s | Solar Warehouse" },
  description: "Central warehouse transfer and cost management",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#116149", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
