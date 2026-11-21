"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import {
  IconChart,
  IconDownload,
  IconReceipt,
  IconSparkles,
  IconTag,
  IconUsers,
  IconWallet,
} from "@/components/icons";
import { useToast } from "@/components/overlay";
import { PeriodPicker, formatDay, usePeriod } from "@/components/PeriodPicker";
import { Button, Card, ErrorText, Loading, PageHeader, buttonClass, cardClass } from "@/components/ui";
import { api, apiDownload } from "@/lib/api";
import { formatRupiah } from "@/lib/format";
import type { Report, ReportRow, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const BREAKDOWN_TOP = 5;
function compactRupiah(v: number): string {
  if (v >= 1_000_000) return `Rp\u00a0${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}\u00a0jt`;
  if (v >= 1_000) return `Rp\u00a0${Math.round(v / 1_000).toLocaleString("id-ID")}\u00a0rb`;
  return formatRupiah(v);
}

interface Bucket {
  key: string;
  label: string;
  tooltip: string;
  orders: number;
  revenue: number;
}

function buckets(days: Report["by_day"]): { unit: string; items: Bucket[] } {
  if (days.length <= 62) {
    return {
      unit: "hari",
      items: days.map((d) => ({
        key: d.date,
        label: formatDay(d.date, { day: "numeric", month: "short" }),
        tooltip: formatDay(d.date, { weekday: "long", day: "numeric", month: "long" }),
        orders: d.orders,
        revenue: d.revenue,
      })),
    };
  }
  const byMonth = days.length > 186;
  const groups = new Map<string, Bucket>();
  days.forEach((d, i) => {
    const key = byMonth ? d.date.slice(0, 7) : days[i - (i % 7)].date;
    const g = groups.get(key) ?? {
      key,
      label: byMonth
        ? formatDay(`${key}-01`, { month: "short", year: "2-digit" })
        : formatDay(key, { day: "numeric", month: "short" }),
      tooltip: byMonth
        ? formatDay(`${key}-01`, { month: "long", year: "numeric" })
        : `Minggu mulai ${formatDay(key, { day: "numeric", month: "long" })}`,
      orders: 0,
      revenue: 0,
    };
    g.orders += d.orders;
    g.revenue += d.revenue;
    groups.set(key, g);
  });
  return { unit: byMonth ? "bulan" : "minggu", items: [...groups.values()] };
}

export default function LaporanPage() {
  const toast = useToast();
  const period = usePeriod();
  const { preset, range } = period;
  const [result, setResult] = useState<{ key: string; report: Report } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const rangeKey = range ? `${range[0]}_${range[1]}` : "";
  const report = result?.key === rangeKey ? result.report : null;

  useEffect(() => {
    if (!rangeKey) return;
    let cancelled = false;
    const [start, end] = rangeKey.split("_");
    api<Report>(`/reports/summary?start=${start}&end=${end}`)
      .then((r) => {
        if (cancelled) return;
        setResult({ key: rangeKey, report: r });
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  async function download() {
    if (!range) return;
    const [start, end] = range;
    setDownloading(true);
    try {
      await apiDownload(
        `/reports/orders.csv?start=${start}&end=${end}`,
        `pesanan-gedklin-${start}-sd-${end}.csv`,
      );
      toast("File CSV diunduh");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal mengunduh", "error");
    } finally {
      setDownloading(false);
    }
  }

  const analysisHref = range
    ? `/dasbor/laporan/analisis?${new URLSearchParams(
        preset === "custom" ? { periode: preset, start: range[0], end: range[1] } : { periode: preset },
      )}`
    : "/dasbor/laporan/analisis";

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Laporan"
        description="Pesanan batal tidak dihitung."
        actions={
          <>
            <Button variant="secondary" onClick={download} loading={downloading} disabled={!range}>
              <IconDownload size={18} />
              Unduh CSV
            </Button>
            <Link href={analysisHref} className={buttonClass("primary")}>
              <IconSparkles size={18} />
              Analisis AI
            </Link>
          </>
        }
      />

      <div className="mb-5">
        <PeriodPicker period={period} />
      </div>

      {error && (
        <div className="mb-5">
          <ErrorText message={error} />
        </div>
      )}

      {!report ? (
        !error && (
          <div className={cardClass}>
            <Loading rows={6} />
          </div>
        )
      ) : (
        <ReportBody report={report} />
      )}
    </AppShell>
  );
}

function ReportBody({ report: r }: { report: Report }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          label="Pendapatan"
          value={formatRupiah(r.revenue)}
          sub={r.orders ? `±${formatRupiah(r.avg_order_value)}/pesanan` : undefined}
        />
        <Kpi
          label="Pesanan"
          value={r.orders.toLocaleString("id-ID")}
          sub={[r.express_orders && `${r.express_orders} Express`, r.cancelled_orders && `${r.cancelled_orders} dibatalkan`]
            .filter(Boolean)
            .join(" · ") || undefined}
        />
        <Kpi label="Berat cucian" value={`${r.weight_kg.toLocaleString("id-ID", { maximumFractionDigits: 1 })} kg`} />
        <Kpi
          label="Belum lunas"
          value={formatRupiah(r.unpaid_total)}
          sub={r.unpaid_orders ? `${r.unpaid_orders} pesanan, ditagih saat ambil` : "Semua lunas"}
          warn={r.unpaid_total > 0}
        />
      </div>

      <RevenueChart report={r} />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <BreakdownCard
          icon={IconTag}
          title="Per layanan"
          rows={r.by_service}
          total={r.revenue}
          qty={(row) =>
            [row.weight_kg ? `${row.weight_kg.toLocaleString("id-ID")} kg` : null, row.qty_pcs ? `${row.qty_pcs} pcs` : null]
              .filter(Boolean)
              .join(" · ")
          }
        />
        <BreakdownCard icon={IconUsers} title="Per kasir" rows={r.by_cashier} total={r.revenue} />
        <BreakdownCard icon={IconWallet} title="Per metode bayar" rows={r.by_payment} total={r.revenue} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      <p className="label-caps text-muted">{label}</p>
      <p className="tabular display mt-1 truncate text-2xl text-ink">{value}</p>
      {sub && <p className={`mt-1 text-sm ${warn ? "font-semibold text-warn-700" : "text-muted"}`}>{sub}</p>}
    </div>
  );
}

function RevenueChart({ report }: { report: Report }) {
  const { unit, items } = useMemo(() => buckets(report.by_day), [report.by_day]);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(...items.map((b) => b.revenue), 1);
  // Label sumbu-x paling banyak ±8 (±4 di HP) supaya tidak bertumpuk; label HP selalu bagian dari label desktop.
  const every = Math.max(1, Math.ceil(items.length / 8));
  const everyNarrow = every * Math.max(1, Math.ceil(Math.ceil(items.length / 4) / every));
  const active = hover ?? null;

  return (
    <Card
      icon={IconChart}
      title={`Pendapatan per ${unit}`}
      description={`Total ${formatRupiah(report.revenue)} dari ${report.orders} pesanan`}
      action={
        <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? "Lihat grafik" : "Lihat tabel"}
        </Button>
      }
    >
      {report.orders === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Belum ada pesanan pada periode ini.</p>
      ) : showTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
              <tr>
                <th className="py-2 font-medium capitalize">{unit}</th>
                <th className="py-2 text-right font-medium">Pesanan</th>
                <th className="py-2 text-right font-medium">Pendapatan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.key} className="border-t border-line">
                  <td className="py-2 text-ink-2">{b.tooltip}</td>
                  <td className="tabular py-2 text-right text-ink-2">{b.orders}</td>
                  <td className="tabular py-2 text-right font-medium text-ink">{formatRupiah(b.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="tabular flex h-56 w-16 shrink-0 flex-col justify-between pt-6 text-right text-xs text-muted" aria-hidden="true">
            <span>{compactRupiah(max)}</span>
            <span>{compactRupiah(max / 2)}</span>
            <span>0</span>
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56" aria-hidden="true">
              <div className="absolute inset-x-0 top-6 border-t border-dashed border-line" />
              <div className="absolute inset-x-0 top-[124px] border-t border-dashed border-line" />
              <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
            </div>
            <ul className="relative flex h-56 items-end gap-0.5 pt-6" aria-label={`Pendapatan per ${unit}`}>
              {items.map((b, i) => {
                const pct = (b.revenue / max) * 100;
                const isActive = active === i;
                return (
                  <li
                    key={b.key}
                    className="relative flex h-full min-w-0 flex-1 items-end"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <button
                      type="button"
                      className="flex h-full w-full items-end rounded-sm px-[1px] focus-visible:outline-offset-2"
                      aria-label={`${b.tooltip}: ${formatRupiah(b.revenue)}, ${b.orders} pesanan`}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                    >
                      <span
                        className={`mx-auto block w-full max-w-12 rounded-t-[4px] transition-[height,background-color] duration-200 ${
                          isActive ? "bg-brand-700" : "bg-brand-500"
                        }`}
                        style={{ height: `${Math.max(pct, b.revenue > 0 ? 1.5 : 0)}%` }}
                      />
                    </button>
                    {isActive && (
                      <span
                        className={`pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-pop ${
                          i < items.length / 2 ? "left-0" : "right-0"
                        }`}
                      >
                        <span className="block text-white/70">{b.tooltip}</span>
                        <span className="tabular block font-semibold">{formatRupiah(b.revenue)}</span>
                        <span className="tabular block text-white/70">{b.orders} pesanan</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <ul className="mt-2 flex gap-0.5" aria-hidden="true">
              {items.map((b, i) => (
                <li key={b.key} className="min-w-0 flex-1 overflow-visible text-center text-xs text-muted">
                  <span
                    className={
                      i % everyNarrow === 0
                        ? "whitespace-nowrap"
                        : i % every === 0
                          ? "invisible whitespace-nowrap sm:visible"
                          : "invisible"
                    }
                  >
                    {b.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

function BreakdownCard({
  icon,
  title,
  rows,
  total,
  qty,
}: {
  icon: typeof IconReceipt;
  title: string;
  rows: ReportRow[];
  total: number;
  qty?: (row: ReportRow) => string;
}) {
  // Baris sudah urut pendapatan terbesar; sisanya disembunyikan agar kartu sejajar dan yang penting terbaca dulu.
  const [expanded, setExpanded] = useState(false);
  const hidden = rows.length - BREAKDOWN_TOP;
  const shown = expanded || hidden <= 0 ? rows : rows.slice(0, BREAKDOWN_TOP);
  return (
    <Card icon={icon} tone="neutral" title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Belum ada data.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((row) => {
              const share = total ? Math.round((row.revenue / total) * 100) : 0;
              const detail = qty?.(row);
              return (
                <li key={row.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium text-ink">{row.label}</span>
                    <span className="tabular shrink-0 font-semibold text-ink">{formatRupiah(row.revenue)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                    </div>
                    <span className="tabular w-10 shrink-0 text-right text-xs text-muted">{share}%</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.orders} pesanan{detail ? ` · ${detail}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          {hidden > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? `Tampilkan ${BREAKDOWN_TOP} teratas` : `Tampilkan semua (${rows.length})`}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
