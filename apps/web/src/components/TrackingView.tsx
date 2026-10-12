"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { STATUS_LABEL, formatDateTime, relativeEta, serviceLabel } from "@/lib/format";
import type { OrderStatus, Tracking } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { Button, ErrorText, ExpressBadge, Loading, StatusBadge } from "./ui";

const REFRESH_MS = 60_000;

function steps(order: Tracking): OrderStatus[] {
  const base: OrderStatus[] = ["RECEIVED", "WASHING", "DRYING"];
  if (order.service_type === "CKS") base.push("IRONING");
  return [...base, "READY", "PICKED_UP"];
}

export function TrackingView({ code }: { code: string }) {
  const [order, setOrder] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
              ? "Kode pesanan tidak ditemukan. Periksa kembali kode di nota Anda."
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

  if (loading) return <Loading />;
  if (!order)
    return (
      <div className="space-y-4">
        <ErrorText message={error} />
        <Link href="/lacak" className="text-sm text-teal-700 hover:underline">
          ← Coba kode lain
        </Link>
      </div>
    );

  const flow = steps(order);
  const currentIndex = flow.indexOf(order.status);
  const reached = new Map(order.history.map((h) => [h.to_status, h.changed_at]));
  const isDone = order.status === "READY" || order.status === "PICKED_UP";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/lacak" className="text-sm text-slate-500 hover:text-teal-700">
          ← Lacak lainnya
        </Link>
        <span className="font-mono text-sm tracking-widest text-slate-500">
          {order.tracking_code}
        </span>
      </div>

      <section className="rounded-2xl bg-teal-600 p-5 text-white shadow">
        <p className="text-sm text-teal-100">Status saat ini</p>
        <p className="text-2xl font-bold">{STATUS_LABEL[order.status]}</p>
        {order.status === "READY" ? (
          <p className="mt-3 text-sm">
            Cucian Anda sudah siap diambil sejak {formatDateTime(order.ready_at)}.
          </p>
        ) : order.status === "PICKED_UP" ? (
          <p className="mt-3 text-sm">Diambil pada {formatDateTime(order.picked_up_at)}. Terima kasih!</p>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-teal-100">Perkiraan siap diambil</p>
            <p className="text-lg font-semibold">{formatDateTime(order.predicted_ready_at)}</p>
            <p className="text-xs text-teal-100">{relativeEta(order.predicted_ready_at, now)}</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span className="font-medium">{serviceLabel(order.service_type, order.is_express)}</span>
          {order.is_express && <ExpressBadge />}
          <span className="text-slate-400">·</span>
          <span>{order.weight_kg} kg</span>
          <span className="ml-auto">
            <StatusBadge status={order.status} />
          </span>
        </div>
        <ol className="space-y-3">
          {flow.map((s, i) => {
            const done = i <= currentIndex;
            return (
              <li key={s} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    done ? "bg-teal-600 text-white" : "border-2 border-slate-300 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <div className="flex-1">
                  <p className={done ? "font-medium text-slate-900" : "text-slate-400"}>
                    {STATUS_LABEL[s]}
                  </p>
                  {reached.get(s) && (
                    <p className="text-xs text-slate-500">{formatDateTime(reached.get(s))}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {!isDone && (
        <p className="text-center text-xs text-slate-500">
          Perkiraan dihitung otomatis dari kondisi antrean dan dapat berubah saat ramai. Kami akan
          mengabari lewat WhatsApp saat cucian siap diambil.
        </p>
      )}
      <div className="text-center">
        <Button variant="secondary" onClick={load}>
          Muat ulang
        </Button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}
