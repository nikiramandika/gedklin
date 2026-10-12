import type { Metadata } from "next";

import { OfflineRetry } from "@/components/OfflineRetry";
import { BrandMark, IconWifiOff } from "@/components/icons";

export const metadata: Metadata = { title: "Offline - Gedklin" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-card">
        <div className="mx-auto mb-4 flex w-fit items-center gap-2">
          <BrandMark size={28} />
          <span className="font-semibold text-ink">Gedklin</span>
        </div>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-warn-50 text-warn-700">
          <IconWifiOff size={22} />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-ink">Tidak ada koneksi internet</h1>
        <p className="mt-1 text-sm text-muted">
          Halaman ini belum tersimpan di perangkat. Periksa Wi-Fi atau data seluler, lalu coba lagi.
        </p>
        <OfflineRetry />
      </div>
    </main>
  );
}
