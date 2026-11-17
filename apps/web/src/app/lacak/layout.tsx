import type { Metadata } from "next";

export const metadata: Metadata = { manifest: "/lacak.webmanifest" };

export default function LacakLayout({ children }: LayoutProps<"/lacak">) {
  return children;
}
