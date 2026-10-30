import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server mandiri yang ringan untuk image Docker production (node server.js).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
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
