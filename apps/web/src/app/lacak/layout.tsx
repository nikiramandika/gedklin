import type { Metadata } from "next";

// Portal pelanggan dipasang sebagai aplikasi tersendiri yang terbuka di /lacak.
export const metadata: Metadata = { manifest: "/lacak.webmanifest" };

export default function LacakLayout({ children }: LayoutProps<"/lacak">) {
  return children;
}
