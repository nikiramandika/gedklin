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

// Papan dibagi per tahap kerja: setiap tab hanya punya satu jenis aksi, jadi kasir bisa menyelesaikan satu tahap sekaligus.
export type BoardTab = "received" | "processing" | "ready";

const REFRESH_MS = 30_000;
const DAY_MS = 86_400_000;

export const BOARD_TABS: { key: BoardTab; label: string; short: string }[] = [
  { key: "received", label: "Belum diproses", short: "Masuk" },
  { key: "processing", label: "Diproses", short: "Proses" },
  { key: "ready", label: "Siap diambil", short: "Siap" },
];

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

  // Urutan antrean dari server (PROCESSING dulu, Express, eskalasi Reguler, FIFO) dipertahankan di tiap tab.
  const received = queue?.filter((o) => o.status === "RECEIVED") ?? null;
  const processing = queue?.filter((o) => o.status === "PROCESSING") ?? null;

  return { queue, received, processing, ready, error, reload };
}

export function boardCount(board: ReturnType<typeof useBoardData>, tab: BoardTab): number | undefined {
  const list = tab === "received" ? board.received : tab === "processing" ? board.processing : board.ready;
  return list?.length;
}

export function OrderBoard({
  tab,
  onTabChange,
  board,
  highlightId,
  onStatusChanged,
}: {
  tab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
  board: ReturnType<typeof useBoardData>;
  highlightId: number | null;
  onStatusChanged: (message: string) => void;
}) {
  const { error, reload } = board;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Order[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [dialog, setDialog] = useState<OrderDialog>(null);
  const [shownQuery, setShownQuery] = useState("");
  const lastQuery = useRef("");

  const runSearch = useCallback(async (q: string) => {
    lastQuery.current = q;
    setShownQuery(q.trim());
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

  function clearSearch() {
    setQuery("");
    lastQuery.current = "";
    setShownQuery("");
    setResults(null);
  }

  async function refresh() {
    setRefreshing(true);
    await reload();
    if (lastQuery.current) await runSearch(lastQuery.current);
    setRefreshing(false);
  }

  async function afterChange(message: string) {
    onStatusChanged(message);
    setDetailVersion((v) => v + 1);
    await reload();
    if (lastQuery.current) await runSearch(lastQuery.current);
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

  const searchMode = results !== null || searching;
  const list = searchMode
    ? results
    : tab === "received"
      ? board.received
      : tab === "processing"
        ? board.processing
        : board.ready;

  return (
    <section className="@container flex min-h-0 flex-col rounded-2xl bg-surface shadow-card">
      <h2 className="px-4 pt-4 text-base font-semibold text-ink lg:hidden">
        {searchMode ? "Hasil pencarian" : BOARD_TABS.find((t) => t.key === tab)?.label}
      </h2>
      <header className="hidden px-3 pt-3 sm:px-4 lg:block">
        <div role="tablist" aria-label="Tahap pesanan" className="flex gap-1 overflow-x-auto rounded-xl bg-canvas p-1">
          {BOARD_TABS.map((t) => {
            const active = !searchMode && tab === t.key;
            const count = boardCount(board, t.key);
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  clearSearch();
                  onTabChange(t.key);
                }}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 pointer-coarse:h-11 ${
                  active ? "bg-surface text-brand-700 shadow-tile" : "text-muted hover:bg-surface/70 hover:text-ink"
                }`}
              >
                {t.label}
                {count !== undefined && (
                  <span
                    className={`tabular rounded-full px-1.5 text-xs font-medium leading-5 ${
                      active ? "bg-brand-600 text-white" : "bg-surface text-muted"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <form
        className="flex items-center gap-2 px-3 py-3 sm:px-4"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
      >
        <div className="relative flex-1">
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className={`${inputClass} pl-9`}
            type="search"
            enterKeyHint="search"
            placeholder="Kode, nama, atau WA"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) clearSearch();
            }}
            aria-label="Cari pesanan"
          />
        </div>
        <Button type="submit" variant="secondary" loading={searching} disabled={!query.trim()}>
          Cari
        </Button>
        <IconButton
          label="Muat ulang"
          icon={IconRefresh}
          size={16}
          onClick={refresh}
          className={refreshing ? "[&_svg]:animate-spin" : ""}
        />
      </form>

      {searchMode && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2 text-sm sm:mx-4">
          <span className="text-muted">
            Hasil untuk <span className="font-medium text-ink">“{shownQuery}”</span>
            {results && <span className="tabular"> · {results.length}</span>}
          </span>
          <button type="button" onClick={clearSearch} className="font-medium text-brand-600 hover:text-brand-700">
            Tutup pencarian
          </button>
        </div>
      )}

      {(error || actionError) && (
        <div className="space-y-2 p-3 sm:p-4">
          <ErrorText message={error} />
          <ErrorText message={actionError} />
        </div>
      )}

      {list === null ? (
        <Loading rows={5} />
      ) : list.length === 0 ? (
        searchMode ? (
          <EmptyState icon={IconSearch} title="Tidak ditemukan">
            Cek ejaan nama, nomor WA, atau kode.
          </EmptyState>
        ) : (
          <EmptyBoard tab={tab} />
        )
      ) : (
        <ul className={tileListClass}>
          {list.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              showPosition={!searchMode && tab !== "ready"}
              showStatus={searchMode}
              highlight={o.id === highlightId}
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
  if (tab === "received")
    return (
      <EmptyState icon={IconList} title="Tidak ada cucian baru">
        Nota yang baru disimpan muncul di sini.
      </EmptyState>
    );
  if (tab === "processing")
    return (
      <EmptyState icon={IconClock} title="Tidak ada yang sedang diproses">
        Tekan “Mulai Proses” saat cucian masuk mesin.
      </EmptyState>
    );
  return (
    <EmptyState icon={IconPackageCheck} title="Rak kosong">
      Belum ada cucian yang menunggu diambil.
    </EmptyState>
  );
}

function OrderRow({
  order: o,
  showPosition,
  showStatus,
  highlight,
  onAdvance,
  onOpen,
}: {
  order: Order;
  showPosition: boolean;
  showStatus: boolean;
  highlight: boolean;
  onAdvance: (o: Order) => Promise<void>;
  onOpen: () => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  // Stempel status "menjejak" hanya saat status berubah, bukan setiap kali daftar dimuat.
  const [shownStatus, setShownStatus] = useState(o.status);
  const [stampKey, setStampKey] = useState(0);
  if (shownStatus !== o.status) {
    setShownStatus(o.status);
    setStampKey((k) => k + 1);
  }

  // Terlambat diukur dari janji standar di nota, bukan dari perkiraan.
  const timing = etaState(o, now);
  const overdue = timing === "late";
  const waitingDays = o.ready_at && now > 0 ? Math.floor((now - new Date(o.ready_at).getTime()) / DAY_MS) : 0;

  async function run() {
    setBusy(true);
    await onAdvance(o);
    setBusy(false);
  }

  // Di tab Siap diambil, kata "Siap" berulang; cukup tanggalnya. Di hasil cari, labelnya tetap perlu.
  const eta = o.ready_at
    ? {
        main: showStatus ? `Siap ${formatDateTime(o.ready_at)}` : formatDateTime(o.ready_at),
        sub: waitingDays > 0 ? `menunggu ${waitingDays} hari` : "siap hari ini",
      }
    : overdue
      ? { main: "Terlambat", sub: `janji ${formatDateTime(o.promised_ready_at)}` }
      : timing === "due"
        ? { main: "Segera siap", sub: formatDateTime(o.predicted_ready_at) }
        : {
            main: formatDateTime(o.predicted_ready_at),
            sub: now > 0 ? relativeEta(o.predicted_ready_at, now) : null,
          };
  const etaTone = overdue ? "text-danger-700" : waitingDays >= 3 ? "text-warn-700" : "text-ink";
  const restCol = showPosition ? "col-start-2" : "col-start-1";

  return (
    <li
      // Seluruh kartu membuka detail; tombol aksi dan link nota di dalamnya tetap bekerja sendiri.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button:not([data-open-detail])")) return;
        onOpen();
      }}
      className={`${tileClass} grid cursor-pointer items-start gap-x-3 gap-y-2 px-4 py-3 active:scale-[0.995] ${
        showPosition
          ? "grid-cols-[1.25rem_minmax(0,1fr)] @xl:grid-cols-[1.25rem_minmax(0,1fr)_9.5rem_8rem]"
          : showStatus
            ? "grid-cols-[minmax(0,1fr)] @xl:grid-cols-[minmax(0,1fr)_9.5rem_6.5rem_8rem]"
            : "grid-cols-[minmax(0,1fr)] @xl:grid-cols-[minmax(0,1fr)_9.5rem_8rem]"
      } @xl:items-center ${
        overdue ? "bg-danger-50/50 hover:bg-danger-50" : highlight ? "bg-brand-50 animate-[fade-in_600ms_ease-out]" : ""
      }`}
    >
      {showPosition && (
        <span
          className={`tabular pt-0.5 text-right text-sm font-medium @xl:pt-0 ${o.is_express ? "text-danger-700" : "text-faint"}`}
          aria-label={`Urutan ${o.queue_position}`}
        >
          {o.queue_position}
        </span>
      )}

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onOpen}
            className="truncate rounded text-left text-base font-medium text-ink underline-offset-4 hover:text-brand-700 hover:underline"
            title="Lihat detail pesanan"
          >
            {o.customer.name}
          </button>
          {o.is_express && <ExpressBadge />}
          {o.ready_at && <PaymentBadge paid={o.is_paid} />}
          {o.rack_location && (
            <span className="inline-flex items-center gap-1 rounded bg-subtle px-1.5 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">
              Rak <span className="font-mono font-semibold text-ink">{o.rack_location}</span>
            </span>
          )}
          {showStatus && (
            <span className="@xl:hidden">
              <StatusBadge status={o.status} />
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onOpen}
          tabIndex={-1}
          className="mt-0.5 line-clamp-2 text-left text-sm text-ink-2"
        >
          {summarizeItems(o.items)}
        </button>
        <p className="mt-0.5 flex items-center gap-x-1.5 text-xs text-muted">
          <Link href={`/nota/${o.id}`} target="_blank" className="serial hover:underline" title="Buka nota">
            {o.tracking_code}
          </Link>
          <span aria-hidden="true">·</span>
          <span className="tabular">{formatRupiah(o.price_total)}</span>
        </p>
      </div>

      <div className={`${restCol} flex items-center gap-1.5 text-sm @xl:col-start-auto @xl:block @xl:text-right ${etaTone}`}>
        {overdue && <IconAlert size={14} className="shrink-0 @xl:hidden" />}
        {!overdue && <IconClock size={14} className="shrink-0 text-faint @xl:hidden" />}
        <span className="tabular font-medium @xl:block">{eta.main}</span>
        {eta.sub && <span className="tabular text-muted @xl:block @xl:text-xs">· {eta.sub}</span>}
      </div>

      {showStatus && (
        <span key={stampKey} className={`hidden @xl:inline-flex ${stampKey ? "animate-stamp" : ""}`}>
          <StatusBadge status={o.status} />
        </span>
      )}

      <div className={`${restCol} @xl:col-start-auto`}>
        {o.next_status && (
          <Button
            variant={o.next_status === "READY" ? "primary" : "secondary"}
            size="sm"
            className="w-full"
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
