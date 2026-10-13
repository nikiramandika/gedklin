"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { STATUS_LABEL, describeItem, formatDateTime, relativeEta, speedLabel } from "@/lib/format";
import type { OrderStatus, Tracking } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { BrandMark, IconArrowLeft, IconCheck, IconPackageCheck, IconRefresh, IconSearch } from "./icons";
import { Alert, Button, ExpressBadge, buttonClass } from "./ui";

const REFRESH_MS = 60_000;

const STEPS: { status: OrderStatus; hint: string }[] = [
  { status: "RECEIVED", hint: "Cucian dicatat di kasir" },
  { status: "PROCESSING", hint: "Sedang dicuci, dikeringkan, atau disetrika" },
  { status: "READY", hint: "Sudah dikemas, bisa diambil" },
  { status: "PICKED_UP", hint: "Sudah diambil" },
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
              ? "Kode tidak ditemukan. Periksa kembali kode di nota Anda; huruf O dan angka 0 tidak dipakai."
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
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-nav-ink hover:bg-nav-2 hover:text-white"
          >
            <IconArrowLeft size={20} />
          </Link>
          <BrandMark size={28} />
          <p className="flex-1 text-[15px] font-semibold">Gedklin Laundry</p>
          <span className="pr-2 font-mono text-[13px] tracking-wider text-nav-ink">{code}</span>
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

  return (
    <>
      <section
        className={`overflow-hidden rounded-2xl p-5 text-white shadow-pop ${
          ready ? "bg-ok-700" : done || cancelled ? "bg-ink-2" : "bg-brand-700"
        }`}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-white/80">Status saat ini</p>
          {order.is_express && <ExpressBadge className="ring-0" />}
        </div>
        <p className="mt-1 flex items-center gap-2 text-[26px] font-semibold tracking-tight">
          {(ready || done) && <IconPackageCheck size={26} />}
          {STATUS_LABEL[order.status]}
        </p>

        <div className="mt-4 rounded-xl bg-white/10 p-4">
          {cancelled ? (
            <p className="text-[15px]">
              Pesanan ini sudah dibatalkan. Hubungi Gedklin Laundry bila ada pertanyaan.
            </p>
          ) : ready ? (
            <p className="text-[15px]">
              Cucian sudah siap sejak <strong className="font-semibold">{formatDateTime(order.ready_at)}</strong>.
              Silakan datang ke outlet dan tunjukkan kode lacak ini.
            </p>
          ) : done ? (
            <p className="text-[15px]">
              Diambil pada <strong className="font-semibold">{formatDateTime(order.picked_up_at)}</strong>. Terima
              kasih sudah mencuci di Gedklin!
            </p>
          ) : (
            <>
              <p className="text-[13px] text-white/75">Perkiraan siap diambil</p>
              <p className="tabular mt-0.5 text-xl font-semibold">{formatDateTime(order.predicted_ready_at)}</p>
              {now > 0 && <p className="text-sm text-white/80">{relativeEta(order.predicted_ready_at, now)}</p>}
              {order.promised_ready_at && order.promised_ready_at !== order.predicted_ready_at && (
                <p className="mt-2 text-xs text-white/70">
                  Janji standar: {formatDateTime(order.promised_ready_at)}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {!cancelled && (
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink">Perjalanan cucian</h2>
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
                    className={`absolute left-[13px] top-7 h-[calc(100%-24px)] w-0.5 rounded-full ${
                      i < currentIndex ? "bg-brand-500" : "bg-line"
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
                  <p className={isDone ? "font-medium text-ink" : "text-faint"}>{STATUS_LABEL[s.status]}</p>
                  <p className="text-[13px] text-muted">
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
          <span className="text-sm text-muted">{speedLabel(order.is_express)}</span>
        </div>
        <ul className="mt-3 space-y-2">
          {order.items.map((item, i) => (
            <li key={i} className="rounded-xl bg-subtle px-3 py-2.5 text-sm text-ink-2">
              {describeItem(item)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Masuk {formatDateTime(order.received_at)}</p>
      </section>

      {!ready && !done && (
        <p className="px-2 text-center text-[13px] text-muted text-pretty">
          Perkiraan dihitung otomatis dari kondisi antrean dan bisa berubah saat ramai. Kami akan mengabari lewat
          WhatsApp saat cucian siap diambil.
        </p>
      )}
    </>
  );
}

function TrackingSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Memuat status...</span>
      <div className="skeleton h-48 rounded-2xl" />
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}
