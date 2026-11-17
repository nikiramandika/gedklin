export function GET() {
  return Response.json(
    {
      id: "/lacak",
      name: "Gedklin Laundry - Lacak Cucian",
      short_name: "Lacak Gedklin",
      description: "Pantau status dan perkiraan waktu siap cucian Anda",
      start_url: "/lacak",
      scope: "/",
      display: "standalone",
      background_color: "#eef1f6",
      theme_color: "#0e1730",
      lang: "id",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
