import type { Metadata } from "next";

import { TrackingForm } from "@/components/TrackingForm";

export const metadata: Metadata = { title: "Lacak Cucian - Gedklin Laundry" };

export default function LacakPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="mx-auto mb-3 h-14 w-14" />
        <h1 className="text-2xl font-bold text-slate-900">Lacak Cucian</h1>
        <p className="mt-1 text-sm text-slate-600">Masukkan kode yang tertera di nota Anda.</p>
      </div>
      <div className="w-full max-w-sm">
        <TrackingForm />
      </div>
    </main>
  );
}
