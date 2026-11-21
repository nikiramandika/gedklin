import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Halaman tindak lanjut dulu milik role admin; tautan dan pintasan PWA lama tetap jalan.
  redirects() {
    return [{ source: "/admin", destination: "/tindak-lanjut", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
