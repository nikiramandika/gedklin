"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Card, ErrorText, Loading, Stat, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatRupiah } from "@/lib/format";
import type { Dashboard, OrderStatus, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const STATUS_ORDER: OrderStatus[] = ["RECEIVED", "PROCESSING", "READY", "PICKED_UP"];

export default function DasborPage() {
  return (
    <AppShell roles={ROLES}>
      <DashboardContent />
    </AppShell>
  );
}

function DashboardContent() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<Dashboard>("/dashboard/summary")
        .then(setData)
        .catch((e: Error) => setError(e.message));
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (error) return <ErrorText message={error} />;
  if (!data) return <Loading />;

  const maxOrders = Math.max(1, ...data.last_7_days.map((d) => d.orders));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Dasbor Pemilik</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Pesanan hari ini" value={data.today_orders} hint={`${data.today_kg} kg`} />
        <Stat label="Pendapatan hari ini" value={formatRupiah(data.today_revenue)} />
        <Stat
          label="Sedang diproses"
          value={data.active_orders}
          hint={`${data.active_loads} load dalam antrean`}
        />
        <Stat
          label="Siap, belum diambil"
          value={data.ready_not_picked}
          hint={`${data.needs_followup} perlu ditindaklanjuti`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Pesanan 7 hari terakhir">
          <div className="flex h-48 items-end gap-3">
            {data.last_7_days.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-slate-700">{d.orders}</span>
                <div
                  className="w-full rounded-t bg-teal-500"
                  style={{ height: `${(d.orders / maxOrders) * 140}px` }}
                  title={formatRupiah(d.revenue)}
                />
                <span className="text-[10px] text-slate-500">{formatDate(d.date)}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Akurasi perkiraan (7 hari)">
            {data.eta_mae_hours_7d === null ? (
              <p className="text-sm text-slate-500">Belum ada pesanan selesai.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold text-slate-900">
                  ±{data.eta_mae_hours_7d.toFixed(1)} <span className="text-base">jam</span>
                </p>
                <p className="text-xs text-slate-500">
                  Rata-rata selisih perkiraan vs. waktu siap aktual ({data.eta_samples_7d} pesanan)
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-500">Tepat (± {data.eta_tolerance_hours} jam)</dt>
                  <dd className="text-right font-medium">
                    {data.eta_within_tolerance_pct_7d ?? "-"}%
                  </dd>
                  <dt className="text-slate-500">Selisih janji standar</dt>
                  <dd className="text-right font-medium">
                    {data.promise_mae_hours_7d === null
                      ? "-"
                      : `±${data.promise_mae_hours_7d.toFixed(1)} jam`}
                  </dd>
                </dl>
              </>
            )}
            <p className="mt-3 text-xs text-slate-400">Model: {data.model_version}</p>
          </Card>
          <Card title="Status pesanan">
            <ul className="space-y-2">
              {STATUS_ORDER.filter((s) => data.status_counts[s]).map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <StatusBadge status={s} />
                  <span className="text-sm font-medium">{data.status_counts[s]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
