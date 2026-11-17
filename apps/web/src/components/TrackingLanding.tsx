import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark, IconReceipt } from "./icons";
import { TrackingForm } from "./TrackingForm";

const STEPS = [
  { icon: IconReceipt, text: "Kode lacak tertulis di nota atau pesan WhatsApp dari kasir." }
];

export function TrackingLanding({ footer }: { footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <section className="pt-safe relative overflow-hidden bg-nav px-4 pb-28 pt-10 text-white sm:pt-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-brand-600/35 blur-3xl"
        />
        <div className="relative mx-auto max-w-md">
          <div className="flex items-center gap-2.5">
            <BrandMark size={36} />
            <div className="leading-tight">
              <p className="font-semibold">Gedklin Laundry</p>
              <p className="text-xs text-nav-faint">Medan</p>
            </div>
          </div>
          <h1 className="mt-8 text-[32px] font-semibold leading-tight tracking-tight text-balance">
            Kapan cucian Anda siap diambil?
          </h1>
          <p className="mt-2 text-[15px] text-nav-ink">
            Masukkan kode lacak untuk melihat status dan perkiraan waktunya.
          </p>
        </div>
      </section>

      <div className="relative mx-auto -mt-20 w-full max-w-md px-4 pb-10">
        <div className="rounded-2xl bg-surface p-5 shadow-pop sm:p-6">
          <TrackingForm />
        </div>
        <ul className="mt-6 space-y-3">
          {STEPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 rounded-xl bg-surface p-3.5 shadow-tile">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon size={18} />
              </span>
              <p className="pt-1.5 text-sm text-ink-2">{text}</p>
            </li>
          ))}
        </ul>
        {footer && <div className="mt-8 text-center">{footer}</div>}
      </div>
    </main>
  );
}

export function StaffLoginLink() {
  return (
    <Link href="/login" className="inline-flex h-11 items-center text-sm font-medium text-muted hover:text-brand-700">
      Masuk sebagai petugas
    </Link>
  );
}
