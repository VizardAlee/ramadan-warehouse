import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AB Ramadan Warehouse",
    short_name: "ABR Warehouse",
    description: "Inventory, branch POS, sales, finance, requests, and warehouse operations for AB Ramadan Ltd.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    background_color: "#f4f7f5",
    theme_color: "#116149",
    orientation: "any",
    lang: "en-NG",
    dir: "ltr",
    categories: ["business", "productivity", "finance"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Open POS", short_name: "POS", description: "Start or continue branch sales", url: "/pos?source=pwa-shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Inventory", short_name: "Inventory", description: "Review stock positions", url: "/inventory?source=pwa-shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Reports", short_name: "Reports", description: "Open operational and sales reports", url: "/reports?source=pwa-shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
