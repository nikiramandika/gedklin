import Link from "next/link";

import { TrackingForm } from "@/components/TrackingForm";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-gradient-to-b from-teal-50 to-slate-50 px-4 py-16">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-3xl font-bold text-slate-900">Gedklin Laundry</h1>
        <p className="mt-2 text-slate-600">Cek status dan perkiraan cucian Anda siap diambil.</p>
      </div>
      <div className="w-full max-w-sm">
        <TrackingForm />
      </div>
      <Link href="/login" className="text-sm text-slate-500 hover:text-teal-700">
        Masuk sebagai petugas
      </Link>
    </main>
  );
}
