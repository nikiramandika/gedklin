import type { MetadataRoute } from "next";

// Aplikasi staf; portal pelanggan punya manifest sendiri di /lacak.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?app=staf",
    name: "Gedklin - Kasir & Dasbor",
    short_name: "Gedklin",
    description: "Kasir, antrean, dan dasbor operasional Gedklin Laundry",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#eef1f6",
    theme_color: "#0e1730",
    lang: "id",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pesanan baru", url: "/kasir", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Tindak lanjut", url: "/admin", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
