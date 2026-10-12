"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import {
  STATUS_ACTION,
  formatDateTime,
  formatRupiah,
  relativeEta,
  speedLabel,
  summarizeItems,
} from "@/lib/format";
import type { Order } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { Button, Card, ErrorText, ExpressBadge, Loading, StatusBadge, inputClass } from "../ui";

type Tab = "queue" | "ready" | "search";
const REFRESH_MS = 30_000;

export function OrderBoard({ refreshKey }: { refreshKey: number }) {
  const [tab, setTab] = useState<Tab>("queue");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const now = useNow();

  const load = useCallback(() => {
    const path =
      tab === "queue"
        ? "/orders/queue"
        : tab === "ready"
          ? "/orders?status=READY&limit=200"
          : `/orders?q=${encodeURIComponent(submittedQuery)}`;
    return api<Order[]>(path)
      .then((data) => {
        setOrders(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [tab, submittedQuery]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  async function advance(order: Order) {
    if (!order.next_status) return;
    if (
      order.next_status === "PICKED_UP" &&
      !confirm(`Tandai pesanan ${order.tracking_code} sudah diambil?`)
    )
      return;
    setBusyId(order.id);
    try {
      await api(`/orders/${order.id}/status`, {
        method: "POST",
        body: { to_status: order.next_status },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status");
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "queue", label: "Antrean" },
    { key: "ready", label: "Siap Diambil" },
    { key: "search", label: "Cari" },
  ];

  return (
    <Card
      title={
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setOrders(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
      action={
        <Button variant="ghost" onClick={load}>
          ↻
        </Button>
      }
    >
      {tab === "search" && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQuery(query);
          }}
        >
          <input
            className={inputClass}
            placeholder="Nama, nomor WA, atau kode"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit">Cari</Button>
        </form>
      )}
      <ErrorText message={error} />
      {orders === null ? (
        <Loading />
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Tidak ada pesanan.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                {tab === "queue" && <th className="px-4 py-2">#</th>}
                <th className="px-4 py-2">Pesanan</th>
                <th className="px-4 py-2">Isi</th>
                <th className="px-4 py-2">Masuk</th>
                <th className="px-4 py-2">{tab === "ready" ? "Siap" : "Perkiraan"}</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const overdue =
                  now > 0 &&
                  o.predicted_ready_at &&
                  !o.ready_at &&
                  new Date(o.predicted_ready_at).getTime() < now;
                return (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0">
                    {tab === "queue" && (
                      <td className="px-4 py-2 font-semibold text-slate-400">
                        {o.queue_position}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <Link
                        href={`/nota/${o.id}`}
                        target="_blank"
                        className="font-mono text-xs text-teal-700 hover:underline"
                      >
                        {o.tracking_code}
                      </Link>
                      <p className="font-medium text-slate-800">{o.customer.name}</p>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        {speedLabel(o.is_express)}
                        {o.is_express && <ExpressBadge />}
                      </div>
                      <p className="max-w-64 text-xs text-slate-500">
                        {summarizeItems(o.items)} · {formatRupiah(o.price_total)}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {formatDateTime(o.received_at)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {o.ready_at ? (
                        formatDateTime(o.ready_at)
                      ) : (
                        <>
                          <span className={overdue ? "font-semibold text-rose-600" : ""}>
                            {formatDateTime(o.predicted_ready_at)}
                          </span>
                          <span className="block text-slate-500">
                            {relativeEta(o.predicted_ready_at, now)}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {o.next_status && (
                        <Button
                          variant={o.next_status === "READY" ? "primary" : "secondary"}
                          disabled={busyId === o.id}
                          onClick={() => advance(o)}
                        >
                          {STATUS_ACTION[o.next_status]}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
