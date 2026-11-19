import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLockup, DrumRings } from "./brand";
import { IconReceipt } from "./icons";
import { TrackingForm } from "./TrackingForm";

export function TrackingLanding({ footer }: { footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <header className="pt-safe relative overflow-hidden bg-nav text-white">
        <DrumRings className="-right-24 -top-20 w-[320px] sm:-right-10 sm:w-[420px]" />
        <div className="relative mx-auto w-full max-w-md px-5 pb-24 pt-8 sm:pt-14">
          <BrandLockup />
          <h1 className="display mt-10 text-4xl leading-tight text-white text-balance">Kapan cucian siap?</h1>
        </div>
      </header>

      <div className="mx-auto -mt-16 w-full max-w-md flex-1 px-4 pb-10">
        <section className="relative rounded-2xl bg-surface p-5 shadow-pop sm:p-6">
          <TrackingForm />
          <p className="mt-4 flex items-start gap-2 border-t border-dashed border-line-strong pt-4 text-sm text-muted">
            <IconReceipt size={16} className="mt-px shrink-0" aria-hidden="true" />
            Kode ada di nota atau WhatsApp dari kasir.
          </p>
        </section>

        {footer && <div className="mt-6 text-center">{footer}</div>}
      </div>
    </main>
  );
}

export function StaffLoginLink() {
  return (
    <Link
      href="/login"
      className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-muted transition-colors hover:bg-surface hover:text-brand-700"
    >
      Masuk sebagai petugas
    </Link>
  );
}
