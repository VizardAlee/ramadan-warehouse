import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AB Ramadan Warehouse",
    short_name: "ABR Warehouse",
    description: "Inventory, store POS, sales, finance, requests, and distribution operations for AB Ramadan Ltd.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    background_color: "#f5f7fc",
    theme_color: "#34458f",
    orientation: "any",
    lang: "en-NG",
    dir: "ltr",
    categories: ["business", "productivity", "finance"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/abr-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/abr-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/abr-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Open POS", short_name: "POS", description: "Start or continue branch sales", url: "/pos?source=pwa-shortcut", icons: [{ src: "/icons/abr-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Inventory", short_name: "Inventory", description: "Review stock positions", url: "/inventory?source=pwa-shortcut", icons: [{ src: "/icons/abr-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Reports", short_name: "Reports", description: "Open operational and sales reports", url: "/reports?source=pwa-shortcut", icons: [{ src: "/icons/abr-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
