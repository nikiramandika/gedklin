import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark, IconReceipt } from "./icons";
import { TrackingForm } from "./TrackingForm";

export function TrackingLanding({ footer }: { footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <div className="pt-safe mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-10 sm:pt-16">
        <div className="flex items-center gap-2.5">
          <BrandMark size={36} />
          <div className="leading-tight">
            <p className="text-base font-semibold text-ink">Gedklin Laundry</p>
            <p className="text-xs text-muted">Medan</p>
          </div>
        </div>

        <section className="mt-8 rounded-2xl bg-surface shadow-card">
          <header className="border-b border-line px-5 py-4">
            <h1 className="display text-2xl text-ink text-balance">Kapan cucian siap?</h1>
          </header>
          <div className="p-5">
            <TrackingForm />
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <IconReceipt size={16} className="shrink-0" aria-hidden="true" />
              Kode ada di nota atau WhatsApp dari kasir.
            </p>
          </div>
        </section>

        {footer && <div className="mt-8 text-center">{footer}</div>}
      </div>
    </main>
  );
}

export function StaffLoginLink() {
  return (
    <Link href="/login" className="inline-flex h-11 items-center text-sm font-semibold text-muted hover:text-brand-700">
      Masuk sebagai petugas
    </Link>
  );
}
