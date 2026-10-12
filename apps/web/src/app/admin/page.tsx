"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Card, ErrorText, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatRupiah, serviceLabel } from "@/lib/format";
import type { Order, Role } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const ROLES: Role[] = ["admin", "owner"];

function daysSince(iso: string | null, now: number): number {
  if (!iso || !now) return 0;
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    api<Order[]>("/admin/followups")
      .then(setOrders)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <AppShell roles={ROLES}>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Perlu Ditindaklanjuti</h1>
      <p className="mb-4 text-sm text-slate-500">
        Cucian sudah siap lebih dari 3 hari tetapi belum diambil. Sistem tidak mengirim WA otomatis;
        silakan hubungi pelanggan secara manual.
      </p>
      <ErrorText message={error} />
      <Card>
        {!orders ? (
          <Loading />
        ) : orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Tidak ada pesanan yang perlu ditindaklanjuti.
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2">Pelanggan</th>
                  <th className="px-4 py-2">Pesanan</th>
                  <th className="px-4 py-2">Siap sejak</th>
                  <th className="px-4 py-2 text-right">Hubungi</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium">{o.customer.name}</p>
                      <p className="font-mono text-xs text-slate-500">+{o.customer.phone_wa}</p>
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-mono text-xs">{o.tracking_code}</p>
                      <p className="text-xs text-slate-500">
                        {serviceLabel(o.service_type, o.is_express)} · {o.weight_kg} kg ·{" "}
                        {formatRupiah(o.price_total)}
                      </p>
                    </td>
                    <td className="px-4 py-2">
                      {formatDateTime(o.ready_at)}
                      <p className="text-xs font-semibold text-rose-600">
                        {daysSince(o.ready_at, now)} hari
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <a
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                        href={`https://wa.me/${o.customer.phone_wa}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Buka WhatsApp
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
