"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { STATUS_LABEL, describeItem, etaState, formatDateTime, relativeEta, speedLabel } from "@/lib/format";
import type { OrderStatus, Tracking } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { BrandMark, IconArrowLeft, IconCheck, IconRefresh, IconSearch } from "./icons";
import { Alert, Button, ExpressBadge, buttonClass } from "./ui";

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const load = useCallback(
    () =>
      api<Tracking>(`/public/track/${encodeURIComponent(code)}`, { auth: false })
        .then((data) => {
          setOrder(data);
          setError(null);
        })
        .catch((err: Error) =>
          setError(
            err instanceof ApiError && err.status === 404
              ? "Kode tidak ditemukan. Cek lagi kode di nota (tanpa huruf O dan angka 0)."
              : err.message,
          ),
        )
        .finally(() => setLoading(false)),
    [code],
  );

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <header className="pt-safe bg-nav text-white">
        <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-2">
          <Link
            href="/lacak"
            aria-label="Lacak kode lain"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-nav-ink hover:bg-nav-2 hover:text-white"
          >
            <IconArrowLeft size={20} />
          </Link>
          <BrandMark size={28} />
          <p className="flex-1 text-base font-semibold">Gedklin</p>
          <span className="pr-2 font-mono text-sm font-semibold tracking-wider text-nav-ink">{code}</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-5">
        {loading ? (
          <TrackingSkeleton />
        ) : !order ? (
          <div className="space-y-4">
            <Alert tone="danger">{error}</Alert>
            <Link href="/lacak" className={buttonClass("secondary", "lg", "w-full")}>
              <IconSearch size={18} />
              Coba kode lain
            </Link>
          </div>
        ) : (
          <TrackingBody order={order} now={now} />
        )}

        {order && (
          <div className="flex flex-col items-center gap-2 pt-2">
            {error && <Alert tone="warn" className="w-full">Gagal memperbarui: {error}</Alert>}
            <Button
              variant="ghost"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            >
              {!refreshing && <IconRefresh size={16} />}
              Perbarui status
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function TrackingBody({ order, now }: { order: Tracking; now: number }) {
  const currentIndex = STEPS.findIndex((s) => s.status === order.status);
  const reached = new Map(order.history.map((h) => [h.to_status, h.changed_at]));
  const ready = order.status === "READY";
  const done = order.status === "PICKED_UP";
  const cancelled = order.status === "CANCELLED";
  const timing = etaState(order, now);
  const stampTone = ready ? "text-ok-700" : cancelled ? "text-danger-600" : done ? "text-faint" : "text-brand-600";

  return (
    <>
      <section className="rounded-2xl bg-surface shadow-card" aria-live="polite">
        <div className="px-5 pb-5 pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className={`display flex items-center gap-3 text-2xl animate-stamp ${stampTone}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              {STATUS_LABEL[order.status]}
            </p>
            {order.is_express && <ExpressBadge />}
          </div>

          <div className="mt-5 border-t border-dashed border-field/60 pt-4 text-ink-2">
            {cancelled ? (
              <p className="text-base">Pesanan dibatalkan. Hubungi Gedklin Laundry bila ada pertanyaan.</p>
            ) : ready ? (
              <p className="text-base">
                Siap sejak <strong className="font-semibold text-ink">{formatDateTime(order.ready_at)}</strong>. Tunjukkan
                kode ini di outlet.
              </p>
            ) : done ? (
              <p className="text-base">
                Diambil <strong className="font-semibold text-ink">{formatDateTime(order.picked_up_at)}</strong>. Terima
                kasih!
              </p>
            ) : timing === "late" ? (
              <>
                <p className="label-caps text-danger-700">Melewati janji standar</p>
                <p className="tabular display mt-1 text-2xl text-ink">{formatDateTime(order.promised_ready_at)}</p>
                <p className="mt-2 text-sm text-muted">Sedang kami selesaikan. Kabar via WhatsApp begitu siap.</p>
              </>
            ) : timing === "due" ? (
              <>
                <p className="label-caps text-muted">Perkiraan siap diambil</p>
                <p className="display mt-1 text-2xl text-ink">Segera siap</p>
                <p className="mt-1 text-sm text-muted">Kabar via WhatsApp begitu siap.</p>
                {order.promised_ready_at && (
                  <p className="mt-2 text-xs text-faint">Janji standar: {formatDateTime(order.promised_ready_at)}</p>
                )}
              </>
            ) : (
              <>
                <p className="label-caps text-muted">Perkiraan siap diambil</p>
                <p className="tabular display mt-1 text-2xl text-ink">{formatDateTime(order.predicted_ready_at)}</p>
                {now > 0 && <p className="mt-1 text-base text-muted">{relativeEta(order.predicted_ready_at, now)}</p>}
                {order.promised_ready_at && order.promised_ready_at !== order.predicted_ready_at && (
                  <p className="mt-2 text-xs text-faint">Janji standar: {formatDateTime(order.promised_ready_at)}</p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {!cancelled && (
        <section className="rounded-lg bg-surface p-5 shadow-card">
          <h2 className="label-caps text-muted">Riwayat</h2>
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

      <section className="rounded-lg bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="label-caps text-muted">Isi pesanan</h2>
          <span className="text-sm font-semibold text-ink-2">{speedLabel(order.is_express)}</span>
        </div>
        <ul className="mt-2 divide-y divide-dashed divide-field/50">
          {order.items.map((item, i) => (
            <li key={i} className="py-2.5 text-base text-ink">
              {describeItem(item)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Masuk {formatDateTime(order.received_at)}</p>
      </section>

      {!ready && !done && (
        <p className="px-2 text-center text-xs text-muted text-pretty">
          Perkiraan bisa berubah saat ramai. Kabar via WhatsApp saat siap.
        </p>
      )}
    </>
  );
}

function TrackingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Memuat status...</span>
      <div className="skeleton h-48 rounded-lg" />
      <div className="skeleton h-64 rounded-lg" />
    </div>
  );
}
