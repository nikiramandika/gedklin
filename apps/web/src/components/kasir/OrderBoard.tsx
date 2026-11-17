"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { STATUS_ACTION, etaState, formatDateTime, formatRupiah, relativeEta, summarizeItems } from "@/lib/format";
import type { Order } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import {
  IconAlert,
  IconClock,
  IconList,
  IconPackageCheck,
  IconReceipt,
  IconRefresh,
  IconSearch,
} from "../icons";
import {
  Button,
  EmptyState,
  ErrorText,
  ExpressBadge,
  IconButton,
  Loading,
  PaymentBadge,
  StatusBadge,
  inputClass,
  tileClass,
  tileListClass,
} from "../ui";
import { OrderActionDialog, type OrderDialog } from "./OrderActions";
import { OrderDetailDrawer } from "./OrderDetailDrawer";

export type BoardTab = "queue" | "ready" | "search";

const REFRESH_MS = 30_000;
const DAY_MS = 86_400_000;

export function useBoardData(refreshKey: number) {
  const [queue, setQueue] = useState<Order[] | null>(null);
  const [ready, setReady] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([
        api<Order[]>("/orders/queue"),
        api<Order[]>("/orders?status=READY&limit=200"),
      ])
        .then(([q, r]) => {
          setQueue(q);
          setReady(r);
          setError(null);
        })
        .catch((err: Error) => setError(err.message)),
    [],
  );

  useEffect(() => {
    reload();
    const id = setInterval(reload, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload, refreshKey]);

  return { queue, ready, error, reload };
}

export function OrderBoard({
  tab,
  onTabChange,
  queue,
  ready,
  error,
  reload,
  onStatusChanged,
}: {
  tab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
  queue: Order[] | null;
  ready: Order[] | null;
  error: string | null;
  reload: () => Promise<void>;
  onStatusChanged: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Order[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [dialog, setDialog] = useState<OrderDialog>(null);
  const lastQuery = useRef("");

  const runSearch = useCallback(async (q: string) => {
    lastQuery.current = q;
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await api<Order[]>(`/orders?q=${encodeURIComponent(q.trim())}`));
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mencari");
    } finally {
      setSearching(false);
    }
  }, []);

  async function refresh() {
    setRefreshing(true);
    await reload();
    if (tab === "search" && lastQuery.current) await runSearch(lastQuery.current);
    setRefreshing(false);
  }

  async function afterChange(message: string) {
    onStatusChanged(message);
    setDetailVersion((v) => v + 1);
    await reload();
    if (tab === "search" && lastQuery.current) await runSearch(lastQuery.current);
  }

  async function advance(order: Order) {
    const next = order.next_status;
    if (!next) return;
    if (next === "READY" || next === "PICKED_UP") {
      setDialog({ kind: next === "READY" ? "ready" : "pickup", order });
      return;
    }
    setActionError(null);
    try {
      await api(`/orders/${order.id}/status`, { method: "POST", body: { to_status: next } });
      await afterChange(`${order.tracking_code} · ${STATUS_DONE[next]}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah status");
    }
  }

  const tabs: { key: BoardTab; label: string; count?: number; icon: typeof IconList }[] = [
    { key: "queue", label: "Antrean", count: queue?.length, icon: IconList },
    { key: "ready", label: "Siap Diambil", count: ready?.length, icon: IconPackageCheck },
    { key: "search", label: "Cari", icon: IconSearch },
  ];

  const list = tab === "queue" ? queue : tab === "ready" ? ready : results;

  return (
    <section className="flex min-h-0 flex-col rounded-2xl bg-surface shadow-card">
      <header className="flex items-center gap-2 rounded-t-2xl bg-gradient-to-b from-tint to-surface px-3 py-3 sm:px-4">
        <div role="tablist" aria-label="Daftar pesanan" className="hidden gap-1 rounded-xl bg-canvas p-1 lg:flex">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(t.key)}
                className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                  active ? "bg-surface text-brand-700 shadow-tile" : "text-muted hover:bg-surface/70 hover:text-ink"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`tabular min-w-6 rounded-full px-1.5 text-center text-xs font-semibold leading-5 ${
                      active ? "bg-brand-600 text-white" : "bg-canvas text-muted"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <h2 className="flex-1 px-1 text-[15px] font-semibold text-ink lg:hidden">
          {tabs.find((t) => t.key === tab)?.label}
          {tab !== "search" && list && (
            <span className="tabular ml-2 text-sm font-normal text-muted">{list.length} pesanan</span>
          )}
        </h2>
        <IconButton
          label="Muat ulang"
          icon={IconRefresh}
          size={18}
          onClick={refresh}
          className={`ml-auto ${refreshing ? "[&_svg]:animate-spin" : ""}`}
        />
      </header>

      {tab === "search" && (
        <form
          className="flex gap-2 px-3 pb-2 sm:px-4"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
        >
          <div className="relative flex-1">
            <IconSearch
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              className={`${inputClass} pl-10`}
              type="search"
              enterKeyHint="search"
              placeholder="Nama, nomor WA, atau kode"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Cari pesanan"
            />
          </div>
          <Button type="submit" loading={searching}>
            Cari
          </Button>
        </form>
      )}

      {(error || actionError) && (
        <div className="space-y-2 p-3 sm:p-4">
          <ErrorText message={error} />
          <ErrorText message={actionError} />
        </div>
      )}

      {tab === "search" && results === null && !searching ? (
        <EmptyState icon={IconSearch} title="Cari pesanan">
          Ketik nama pelanggan, nomor WhatsApp, atau kode lacak di nota.
        </EmptyState>
      ) : list === null ? (
        <Loading rows={5} />
      ) : list.length === 0 ? (
        <EmptyBoard tab={tab} />
      ) : (
        <ul className={tileListClass}>
          {list.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              showPosition={tab === "queue"}
              onAdvance={advance}
              onOpen={() => setDetailId(o.id)}
            />
          ))}
        </ul>
      )}

      <OrderDetailDrawer
        orderId={detailId}
        version={detailVersion}
        onClose={() => setDetailId(null)}
        onAdvance={advance}
        onPay={(order) => setDialog({ kind: "payment", order })}
        onChanged={afterChange}
      />
      <OrderActionDialog
        dialog={dialog}
        onClose={() => setDialog(null)}
        onDone={(_, message) => {
          setDialog(null);
          afterChange(message);
        }}
      />
    </section>
  );
}

const STATUS_DONE: Record<string, string> = {
  PROCESSING: "mulai diproses",
  READY: "ditandai siap diambil",
  PICKED_UP: "sudah diambil",
};

function EmptyBoard({ tab }: { tab: BoardTab }) {
  if (tab === "queue")
    return (
      <EmptyState icon={IconList} title="Antrean kosong">
        Semua cucian sudah selesai. Pesanan baru akan muncul di sini: yang sedang diproses dan Express paling atas.
      </EmptyState>
    );
  if (tab === "ready")
    return (
      <EmptyState icon={IconPackageCheck} title="Tidak ada cucian menunggu">
        Pesanan yang ditandai siap akan muncul di sini sampai diambil pelanggan.
      </EmptyState>
    );
  return (
    <EmptyState icon={IconSearch} title="Tidak ditemukan">
      Periksa ejaan nama, nomor WA, atau kode lacak.
    </EmptyState>
  );
}

function OrderRow({
  order: o,
  showPosition,
  onAdvance,
  onOpen,
}: {
  order: Order;
  showPosition: boolean;
  onAdvance: (o: Order) => Promise<void>;
  onOpen: () => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);

  // Terlambat diukur dari janji standar di nota, bukan dari perkiraan.
  const timing = etaState(o, now);
  const overdue = timing === "late";
  const waitingDays = o.ready_at && now > 0 ? Math.floor((now - new Date(o.ready_at).getTime()) / DAY_MS) : 0;

  async function run() {
    setBusy(true);
    await onAdvance(o);
    setBusy(false);
  }

  return (
    <li
      className={`${tileClass} grid grid-cols-[1fr] gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4 ${
        overdue ? "ring-1 ring-inset ring-danger-600/25" : o.is_express && !o.ready_at ? "ring-1 ring-inset ring-warn-600/20" : ""
      }`}
    >
      <div className="flex min-w-0 gap-3">
        {showPosition && (
          <span
            className={`tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
              o.is_express ? "bg-warn-50 text-warn-700" : "bg-canvas text-muted"
            }`}
            aria-label={`Urutan ${o.queue_position}`}
          >
            {o.queue_position}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onOpen}
              className="truncate rounded text-left font-semibold text-ink underline-offset-4 hover:text-brand-700 hover:underline"
              title="Lihat detail pesanan"
            >
              {o.customer.name}
            </button>
            {o.is_express && <ExpressBadge />}
            {o.ready_at && <PaymentBadge paid={o.is_paid} />}
            {o.rack_location && (
              <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-xs font-semibold text-ink-2">
                Rak {o.rack_location}
              </span>
            )}
            <span className="sm:hidden">
              <StatusBadge status={o.status} />
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <Link
              href={`/nota/${o.id}`}
              target="_blank"
              className="inline-flex items-center gap-1 font-mono font-medium tracking-wider text-brand-700 hover:underline"
              title="Buka nota"
            >
              <IconReceipt size={13} />
              {o.tracking_code}
            </Link>
            <span aria-hidden="true">·</span>
            <span className="tabular">{formatRupiah(o.price_total)}</span>
          </p>
          <button
            type="button"
            onClick={onOpen}
            tabIndex={-1}
            className="mt-1 line-clamp-2 text-left text-[13px] text-ink-2"
          >
            {summarizeItems(o.items)}
          </button>
          <p
            className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] ${
              overdue ? "font-medium text-danger-600" : waitingDays >= 3 ? "font-medium text-warn-700" : "text-muted"
            }`}
          >
            {overdue ? <IconAlert size={14} /> : <IconClock size={14} />}
            {o.ready_at ? (
              <>
                Siap sejak {formatDateTime(o.ready_at)}
                {waitingDays > 0 && <span>· menunggu {waitingDays} hari</span>}
              </>
            ) : (
              <>
                {overdue ? (
                  <>
                    Terlambat · janji {formatDateTime(o.promised_ready_at)}
                    <span className="opacity-80">({relativeEta(o.promised_ready_at, now)})</span>
                  </>
                ) : timing === "due" ? (
                  <>
                    Segera siap · perkiraan {formatDateTime(o.predicted_ready_at)}
                    <span className="opacity-80">(janji {formatDateTime(o.promised_ready_at)})</span>
                  </>
                ) : (
                  <>
                    Perkiraan {formatDateTime(o.predicted_ready_at)}
                    {now > 0 && <span className="opacity-80">({relativeEta(o.predicted_ready_at, now)})</span>}
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:justify-end">
        <span className="hidden sm:inline-flex">
          <StatusBadge status={o.status} />
        </span>
        {o.next_status && (
          <Button
            variant={o.next_status === "READY" ? "primary" : "secondary"}
            className="w-full sm:w-40"
            loading={busy}
            onClick={run}
          >
            {STATUS_ACTION[o.next_status]}
          </Button>
        )}
      </div>
    </li>
  );
}
