import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-context";

export const metadata: Metadata = {
  title: { default: "AB Ramadan Warehouse", template: "%s | AB Ramadan Warehouse" },
  description: "AB Ramadan inventory, request, transfer, and warehouse operations",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#116149", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
