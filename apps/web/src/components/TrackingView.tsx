"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import {
  STATUS_LABEL,
  describeItem,
  etaState,
  formatDateTime,
  formatRupiah,
  relativeEta,
  speedLabel,
} from "@/lib/format";
import type { OrderStatus, Tracking } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { DrumRings } from "./brand";
import { BrandMark, IconAlert, IconArrowLeft, IconCheck, IconRefresh, IconSearch } from "./icons";
import { Alert, Button, EmptyState, ExpressBadge, PaymentBadge, buttonClass } from "./ui";

const REFRESH_MS = 60_000;

const STEPS: { status: OrderStatus; hint: string }[] = [
  { status: "RECEIVED", hint: "Dicatat di kasir" },
  { status: "PROCESSING", hint: "Dicuci, dikeringkan, disetrika" },
  { status: "READY", hint: "Bisa diambil" },
  { status: "PICKED_UP", hint: "Selesai" },
];

export function TrackingView({ code }: { code: string }) {
  const [order, setOrder] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const load = useCallback(
    () =>
      api<Tracking>(`/public/track/${encodeURIComponent(code)}`, { auth: false })
        .then((data) => {
          setOrder(data);
          setError(null);
          setNotFound(false);
        })
        .catch((err: Error) => {
          const missing = err instanceof ApiError && err.status === 404;
          setNotFound(missing);
          setError(missing ? "Kode tidak ditemukan." : err.message);
        })
        .finally(() => setLoading(false)),
    [code],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-canvas">
      {/* Pita navy memanjang ke bawah; kartu status menumpang di atasnya, sama seperti halaman lacak. */}
      <header className="pt-safe relative overflow-hidden bg-nav pb-14 text-white">
        <DrumRings className="-right-24 -top-28 w-[300px]" />
        <div className="relative mx-auto flex h-14 max-w-md items-center gap-2 px-2">
          <Link
            href="/lacak"
            aria-label="Lacak kode lain"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-nav-ink transition-colors hover:bg-nav-2 hover:text-white"
          >
            <IconArrowLeft size={20} />
          </Link>
          <BrandMark size={28} className="rounded-[5px] ring-1 ring-white/15" />
          <p className="flex-1 text-base font-semibold">{order?.outlet.name ?? "Gedklin Laundry"}</p>
        </div>
      </header>

      <div className="relative mx-auto -mt-12 w-full max-w-md flex-1 space-y-4 px-4 pb-8">
        {loading ? (
          <TrackingSkeleton />
        ) : !order ? (
          <section className="rounded-2xl bg-surface shadow-pop">
            {notFound ? (
              <EmptyState
                icon={IconSearch}
                title="Kode tidak ditemukan"
                action={
                  <Link href="/lacak" className={buttonClass("primary", "lg")}>
                    <IconSearch size={18} />
                    Coba kode lain
                  </Link>
                }
              >
                <span className="serial text-serial">{code}</span> tidak terdaftar. Cek lagi kode di nota (tanpa huruf O
                dan angka 0).
              </EmptyState>
            ) : (
              <EmptyState
                icon={IconAlert}
                title="Status belum bisa dimuat"
                action={
                  <Button size="lg" loading={refreshing} onClick={refresh}>
                    {!refreshing && <IconRefresh size={18} />}
                    Coba lagi
                  </Button>
                }
              >
                {error}
              </EmptyState>
            )}
          </section>
        ) : (
          <TrackingBody order={order} code={code} now={now} />
        )}

        {order && (
          <div className="flex flex-col items-center gap-1 pt-2">
            {error && <Alert tone="warn" className="w-full">Gagal memperbarui: {error}</Alert>}
            <Button variant="ghost" loading={refreshing} onClick={refresh}>
              {!refreshing && <IconRefresh size={16} />}
              Perbarui status
            </Button>
            <p className="text-xs text-muted">Diperbarui otomatis tiap menit.</p>
          </div>
        )}
      </div>
    </main>
  );
}

// "08:00:00" -> "08.00", penulisan jam yang lazim di Indonesia.
function clock(value: string): string {
  return value.slice(0, 5).replace(":", ".");
}

const STAMP_TONE = {
  ready: "text-ok-700",
  cancelled: "text-danger-600",
  done: "text-muted",
  active: "text-brand-600",
};

function TrackingBody({ order, code, now }: { order: Tracking; code: string; now: number }) {
  const currentIndex = STEPS.findIndex((s) => s.status === order.status);
  const reached = new Map(order.history.map((h) => [h.to_status, h.changed_at]));
  const ready = order.status === "READY";
  const done = order.status === "PICKED_UP";
  const cancelled = order.status === "CANCELLED";
  const timing = etaState(order, now);
  const stampTone = STAMP_TONE[ready ? "ready" : cancelled ? "cancelled" : done ? "done" : "active"];
  // Pelanggan tanpa WhatsApp tidak menerima kabar, jadi jangan menjanjikannya.
  const updateNote = order.whatsapp_updates ? "Kabar via WhatsApp begitu siap." : "Cek lagi halaman ini sebelum datang.";
  const outlet = order.outlet_today;

  return (
    <>
      <section className="rounded-2xl bg-surface shadow-pop" aria-live="polite">
        <div className="px-5 pb-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {order.customer_name && (
                <p className="truncate text-sm text-muted">
                  Pesanan <span className="font-semibold text-ink">{order.customer_name}</span>
                </p>
              )}
              <p className="mt-0.5 flex items-baseline gap-2 text-xs text-muted">
                Kode
                <span className="serial text-base text-serial">{code}</span>
              </p>
            </div>
            {order.is_express && <ExpressBadge className="mt-0.5" />}
          </div>
          {/* Status sebagai stempel di nota; labelnya teks, jadi tidak bergantung pada warna. */}
          <p
            className={`mt-4 inline-flex -rotate-2 items-center rounded-[5px] border-2 border-current px-3 py-1.5 text-xl font-bold uppercase leading-none tracking-[0.08em] animate-stamp ${stampTone}`}
          >
            {STATUS_LABEL[order.status]}
          </p>

          <div className="mt-5 border-t border-dashed border-field/60 pt-4 text-ink-2">
            {cancelled ? (
              <p className="text-base">
                Pesanan dibatalkan. Hubungi {order.outlet.name}
                {order.outlet.phone ? ` (${order.outlet.phone})` : ""} bila ada pertanyaan.
              </p>
            ) : ready ? (
              <>
                <p className="text-base">
                  Siap sejak <strong className="font-semibold text-ink">{formatDateTime(order.ready_at)}</strong>.
                  Tunjukkan kode ini di outlet.
                </p>
                <p className="mt-2 text-sm text-muted">
                  {outlet.is_open
                    ? `Outlet buka hari ini ${clock(outlet.open_time)}–${clock(outlet.close_time)}.`
                    : "Outlet tutup hari ini."}
                </p>
              </>
            ) : done ? (
              <p className="text-base">
                Diambil <strong className="font-semibold text-ink">{formatDateTime(order.picked_up_at)}</strong>. Terima
                kasih!
              </p>
            ) : timing === "late" ? (
              <>
                <p className="label-caps text-danger-700">Melewati janji standar</p>
                <p className="tabular display mt-1 text-3xl text-ink">{formatDateTime(order.promised_ready_at)}</p>
                <p className="mt-2 text-sm text-muted">Sedang kami selesaikan. {updateNote}</p>
              </>
            ) : (
              <>
                <p className="label-caps text-muted">Perkiraan siap diambil</p>
                <p className="tabular display mt-1 text-3xl text-ink">{formatDateTime(order.promised_ready_at)}</p>
                {now > 0 && <p className="mt-1 text-base text-muted">{relativeEta(order.promised_ready_at, now)}</p>}
              </>
            )}
          </div>
        </div>
      </section>

      {!cancelled && (
        <section className="rounded-2xl bg-surface p-5 shadow-card">
          <h2 className="text-base font-semibold text-ink">Riwayat</h2>
          <ol className="mt-4">
            {STEPS.map((s, i) => {
              const isDone = i <= currentIndex;
              const isCurrent = i === currentIndex;
              const last = i === STEPS.length - 1;
              return (
                <li key={s.status} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && (
                    <span
                      aria-hidden="true"
                      className={`absolute left-[13px] top-7 h-[calc(100%-24px)] w-0.5 ${
                        i < currentIndex ? "bg-brand-600" : "border-l-2 border-dashed border-line-strong"
                      }`}
                    />
                  )}
                  <span
                    className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      isDone
                        ? "bg-brand-600 text-white"
                        : "bg-surface text-transparent ring-2 ring-inset ring-line-strong"
                    } ${isCurrent && !done ? "ring-4 ring-brand-100" : ""}`}
                  >
                    <IconCheck size={14} strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className={isDone ? "font-semibold text-ink" : "text-faint"}>{STATUS_LABEL[s.status]}</p>
                    <p className="text-sm text-muted">
                      {reached.get(s.status) ? formatDateTime(reached.get(s.status)) : s.hint}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Isi pesanan</h2>
          <span className="text-sm font-medium text-muted">{speedLabel(order.is_express)}</span>
        </div>
        <ul className="mt-2 divide-y divide-dashed divide-field/50">
          {order.items.map((item, i) => (
            <li key={i} className="py-2.5 text-base text-ink">
              {describeItem(item)}
            </li>
          ))}
        </ul>
        {!cancelled && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-xs text-muted">Total</p>
              <p className="tabular text-lg font-semibold text-ink">{formatRupiah(order.price_total)}</p>
            </div>
            <div className="text-right">
              <PaymentBadge paid={order.is_paid} />
              {!order.is_paid && !done && <p className="mt-1.5 text-xs text-muted">Bayar saat ambil</p>}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Masuk {formatDateTime(order.received_at)}</p>
      </section>

      {!ready && !done && (
        <p className="px-2 text-center text-xs text-muted text-pretty">
          Saat ramai, cucian bisa sedikit melewati perkiraan.{" "}
          {order.whatsapp_updates ? "Kabar via WhatsApp saat siap." : "Cek lagi halaman ini sebelum datang."}
        </p>
      )}
    </>
  );
}

function TrackingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Memuat status...</span>
      <div className="skeleton h-52 rounded-2xl!" />
      <div className="skeleton h-64 rounded-2xl!" />
    </div>
  );
}
