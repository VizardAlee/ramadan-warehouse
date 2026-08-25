import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-context";
import { PwaProvider } from "@/features/pwa/pwa-provider";

export const metadata: Metadata = {
  title: { default: "AB Ramadan Warehouse", template: "%s | AB Ramadan Warehouse" },
  description: "AB Ramadan inventory, request, transfer, and warehouse operations",
  applicationName: "AB Ramadan Warehouse",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ABR Warehouse",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#116149",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-NG"><body><PwaProvider><AuthProvider>{children}</AuthProvider></PwaProvider></body></html>;
}
