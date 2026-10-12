"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import {
  IconAlert,
  IconChart,
  IconChevronRight,
  IconClock,
  IconList,
  IconPackageCheck,
  IconReceipt,
  IconWallet,
} from "@/components/icons";
import {
  Alert,
  Card,
  ErrorText,
  PageHeader,
  Segmented,
  buttonClass,
  cardClass,
  type CardTone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { STATUS_LABEL, formatDate, formatRupiah } from "@/lib/format";
import type { Dashboard, OrderStatus, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const STATUS_ORDER: OrderStatus[] = ["RECEIVED", "PROCESSING", "READY", "PICKED_UP"];
const STATUS_FILL: Record<OrderStatus, string> = {
  RECEIVED: "bg-slate-400",
  PROCESSING: "bg-brand-500",
  READY: "bg-ok-600",
  PICKED_UP: "bg-line-strong",
};

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
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <PageHeader
        title="Dasbor"
        description="Ringkasan hari ini dan tujuh hari terakhir. Diperbarui setiap menit."
        actions={
          <Link href="/kasir" className={buttonClass("primary", "md")}>
            <IconReceipt size={18} />
            Buka Kasir
          </Link>
        }
      />
      {error && (
        <div className="mb-6">
          <ErrorText message={error} />
        </div>
      )}
      {!data ? <DashboardSkeleton /> : <DashboardBody data={data} />}
    </>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  return (
    <div className="space-y-6">
      {data.needs_followup > 0 && (
        <Alert
          tone="warn"
          action={
            <Link
              href="/admin"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline"
            >
              Lihat
              <IconChevronRight size={16} />
            </Link>
          }
        >
          <strong className="font-semibold">{data.needs_followup} cucian</strong> sudah siap lebih
          dari 3 hari dan belum diambil. Hubungi pelanggan dari halaman Tindak Lanjut.
        </Alert>
      )}

      <section aria-label="Angka hari ini" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          icon={IconReceipt}
          tone="brand"
          label="Pesanan hari ini"
          value={String(data.today_orders)}
          sub={`${data.today_kg} kg masuk`}
        />
        <Kpi icon={IconWallet} tone="ok" label="Pendapatan hari ini" value={formatRupiah(data.today_revenue)} />
        <Kpi
          icon={IconList}
          tone="neutral"
          label="Dalam antrean"
          value={String(data.active_orders)}
          sub={`${data.active_loads} load belum siap`}
        />
        <Kpi
          icon={IconPackageCheck}
          tone={data.needs_followup > 0 ? "warn" : "ok"}
          label="Siap, belum diambil"
          value={String(data.ready_not_picked)}
          sub={data.needs_followup > 0 ? `${data.needs_followup} lewat 3 hari` : "Semua masih wajar"}
          warn={data.needs_followup > 0}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <WeekChart days={data.last_7_days} />
        <div className="space-y-6">
          <AccuracyCard data={data} />
          <StatusCard counts={data.status_counts} />
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  warn,
}: {
  icon: typeof IconReceipt;
  tone: CardTone;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className={`${cardClass} p-4 sm:p-5`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${KPI_TONE[tone]}`}>
          <Icon size={18} />
        </span>
      </div>
      <p className="tabular mt-2 truncate text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{value}</p>
      {sub && (
        <p className={`mt-1 flex items-center gap-1 text-xs ${warn ? "font-medium text-warn-700" : "text-muted"}`}>
          {warn && <IconAlert size={13} />}
          {sub}
        </p>
      )}
    </div>
  );
}

const KPI_TONE: Record<CardTone, string> = {
  brand: "bg-brand-50 text-brand-600 ring-brand-100",
  ok: "bg-ok-50 text-ok-700 ring-ok-600/15",
  warn: "bg-warn-50 text-warn-700 ring-warn-600/15",
  neutral: "bg-canvas text-ink-2 ring-line",
};

type Measure = "orders" | "revenue";

function WeekChart({ days }: { days: Dashboard["last_7_days"] }) {
  const [measure, setMeasure] = useState<Measure>("orders");
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((d) => (measure === "orders" ? d.orders : d.revenue));
  const max = Math.max(1, ...values);
  const fmt = (v: number) => (measure === "orders" ? `${v} pesanan` : formatRupiah(v));
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <Card
      icon={IconChart}
      title={measure === "orders" ? "Pesanan 7 hari terakhir" : "Pendapatan 7 hari terakhir"}
      description={`Total ${fmt(total)}`}
      action={
        <div className="w-full sm:w-52">
          <Segmented<Measure>
            label="Ukuran grafik"
            value={measure}
            onChange={setMeasure}
            options={[
              { value: "orders", label: "Pesanan" },
              { value: "revenue", label: "Pendapatan" },
            ]}
          />
        </div>
      }
    >
      <div className="relative">
        {/* Garis bantu tipis di 50% dan 100%. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56" aria-hidden="true">
          <div className="absolute inset-x-0 top-6 border-t border-dashed border-line" />
          <div className="absolute inset-x-0 top-[124px] border-t border-dashed border-line" />
        </div>
        <ul className="relative flex h-56 items-end gap-2 pt-6 sm:gap-4" aria-label="Grafik batang per hari">
          {days.map((d, i) => {
            const v = values[i];
            const pct = (v / max) * 100;
            const isLast = i === days.length - 1;
            return (
              <li
                key={d.date}
                className="group relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <button
                  type="button"
                  className="flex h-full w-full items-end rounded-md focus-visible:outline-offset-4"
                  aria-label={`${formatDate(d.date)}: ${fmt(v)}`}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <span
                    className={`block w-full rounded-t-[4px] transition-[height,background-color] duration-200 ${
                      hover === i ? "bg-brand-700" : isLast ? "bg-brand-600" : "bg-brand-300"
                    }`}
                    style={{ height: `${Math.max(pct, v > 0 ? 2 : 0)}%` }}
                  />
                </button>
                {(hover === i || (hover === null && isLast)) && (
                  <span className="tabular pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-white shadow-pop">
                    {fmt(v)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <ul className="mt-2 flex gap-2 sm:gap-4" aria-hidden="true">
          {days.map((d, i) => (
            <li
              key={d.date}
              className={`flex-1 truncate text-center text-xs ${i === days.length - 1 ? "font-medium text-ink" : "text-muted"}`}
            >
              {formatDate(d.date)}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function AccuracyCard({ data }: { data: Dashboard }) {
  const model = data.eta_mae_hours_7d;
  const promise = data.promise_mae_hours_7d;
  const scale = Math.max(model ?? 0, promise ?? 0, 1);

  return (
    <Card
      icon={IconClock}
      tone="ok"
      title="Akurasi perkiraan siap"
      description={`7 hari terakhir · ${data.eta_samples_7d} pesanan selesai`}
    >
      {model === null ? (
        <p className="text-sm text-muted">
          Belum ada pesanan yang selesai dalam 7 hari terakhir, jadi akurasi belum bisa dihitung.
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="tabular text-[28px] font-semibold tracking-tight text-ink">
              {data.eta_within_tolerance_pct_7d ?? "–"}
              <span className="text-lg text-muted">%</span>
            </p>
            <p className="text-[13px] text-muted">
              perkiraan meleset kurang dari {data.eta_tolerance_hours} jam
            </p>
          </div>
          <div className="space-y-3">
            <p className="text-[13px] font-medium text-ink-2">Rata-rata selisih (makin pendek makin baik)</p>
            <ErrorBar label="Perkiraan sistem" hours={model} scale={scale} strong />
            {promise !== null && <ErrorBar label="Janji standar" hours={promise} scale={scale} />}
          </div>
        </div>
      )}
      <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">Model: {data.model_version}</p>
    </Card>
  );
}

function ErrorBar({ label, hours, scale, strong }: { label: string; hours: number; scale: number; strong?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[13px]">
        <span className={strong ? "font-medium text-ink" : "text-muted"}>{label}</span>
        <span className="tabular font-medium text-ink">±{hours.toFixed(1)} jam</span>
      </div>
      <div className="h-2 rounded-full bg-canvas">
        <div
          className={`h-2 rounded-full ${strong ? "bg-brand-600" : "bg-line-strong"}`}
          style={{ width: `${(hours / scale) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StatusCard({ counts }: { counts: Record<string, number> }) {
  const entries = STATUS_ORDER.map((s) => ({ status: s, n: counts[s] ?? 0 }));
  const total = entries.reduce((a, e) => a + e.n, 0);

  return (
    <Card icon={IconPackageCheck} tone="neutral" title="Status pesanan" description={`${total} pesanan tercatat`}>
      {total > 0 && (
        <div className="mb-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          {entries
            .filter((e) => e.n > 0)
            .map((e) => (
              <div key={e.status} className={STATUS_FILL[e.status]} style={{ flexGrow: e.n }} />
            ))}
        </div>
      )}
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.status} className="flex items-center gap-2.5 text-sm">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_FILL[e.status]}`} aria-hidden="true" />
            <span className="flex-1 text-ink-2">{STATUS_LABEL[e.status]}</span>
            <span className="tabular font-medium text-ink">{e.n}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Memuat dasbor...</span>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}</div>
      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="skeleton h-80 rounded-2xl" />
        <div className="space-y-6">
          <div className="skeleton h-48 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
