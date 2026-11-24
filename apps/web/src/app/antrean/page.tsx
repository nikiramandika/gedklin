"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { IconAlert, IconClock, IconPackageCheck, IconRefresh, IconSearch } from "@/components/icons";
import { Modal, useToast } from "@/components/overlay";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  ExpressBadge,
  Field,
  IconButton,
  Loading,
  PageHeader,
  UrgentBadge,
  inputClass,
  tabClass,
  tabListClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { etaState, formatDateTime, formatKg, relativeEta } from "@/lib/format";
import { isUrgent, startLabel, workDuration } from "@/lib/priority";
import type { Role, WorkItem, WorkOrder } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const ROLES: Role[] = ["staff", "owner"];
const REFRESH_MS = 60_000;
const READY_FORM = "work-ready-form";
// Staff cukup melihat urutan teratas; sisanya dibuka bila perlu supaya halaman tidak memanjang.
const PAGE_SIZE = 10;

type Tab = "working" | "waiting";

function itemLine(item: WorkItem): string {
  const parts = [item.name];
  if (item.weight_kg !== null) parts.push(formatKg(item.weight_kg));
  if (item.qty_pcs) parts.push(`${item.weight_kg !== null ? "+" : ""}${item.qty_pcs} pcs`);
  if (item.machine_loads) parts.push(`· ${item.machine_loads} load`);
  return parts.join(" ");
}

// Kode di label kantong sering diketik tanpa memperhatikan huruf besar atau spasi.
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

export default function AntreanPage() {
  const toast = useToast();
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [finishing, setFinishing] = useState<WorkOrder | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");

  const load = useCallback(
    () =>
      api<WorkOrder[]>("/work/queue")
        .then((o) => {
          setOrders(o);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  // Antrean berubah dari konter (pesanan baru), jadi dimuat ulang berkala.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function start(order: WorkOrder) {
    await api(`/work/${order.id}/status`, { method: "POST", body: { to_status: "PROCESSING" } });
    toast(`${order.tracking_code} mulai dikerjakan`);
    await load();
  }

  // Disaring di sini saja: semua cucian aktif sudah termuat, jadi hasil langsung muncul sambil mengetik.
  const needle = normalize(query);
  const matches = (o: WorkOrder) =>
    !needle || normalize(o.tracking_code).includes(needle) || normalize(o.customer_name).includes(needle);
  const working = orders?.filter((o) => o.status === "PROCESSING" && matches(o)) ?? [];
  const waiting = orders?.filter((o) => o.status === "RECEIVED" && matches(o)) ?? [];
  // Bila belum ada yang dikerjakan, langsung tampilkan yang berikutnya. Saat mencari, pindah ke tab
  // yang punya hasil supaya staff tidak mengira cuciannya tidak ada.
  const preferred: Tab = tab ?? (working.length > 0 ? "working" : "waiting");
  const other: Tab = preferred === "working" ? "waiting" : "working";
  const countOf = (t: Tab) => (t === "working" ? working.length : waiting.length);
  const active: Tab = needle && countOf(preferred) === 0 && countOf(other) > 0 ? other : preferred;
  const list = active === "working" ? working : waiting;
  // Label pendek untuk HP supaya kedua tab dan tombol muat ulang muat dalam satu baris.
  const tabs: { key: Tab; label: string; short: string; count: number }[] = [
    { key: "working", label: "Sedang dikerjakan", short: "Dikerjakan", count: working.length },
    { key: "waiting", label: "Berikutnya", short: "Berikutnya", count: waiting.length },
  ];

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Antrean Cucian"
        description="Kerjakan dari nomor paling kecil. Urutan diatur otomatis dari lama kerja dan janji siap."
      />
      {error && <ErrorText message={error} />}
      {!orders ? (
        !error && <Loading rows={4} />
      ) : orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={IconPackageCheck}
            title="Antrean kosong"
            action={
              <Button variant="secondary" loading={refreshing} onClick={refresh}>
                <IconRefresh size={16} />
                Muat ulang
              </Button>
            }
          >
            Semua cucian sudah siap diambil. Pesanan baru dari kasir akan muncul di sini.
          </EmptyState>
        </Card>
      ) : (
        <Card flush>
          <div className="flex items-center pr-2 sm:pr-3">
            <div role="tablist" aria-label="Tahap cucian" className={`${tabListClass} min-w-0 flex-1`}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setShown(PAGE_SIZE);
                  }}
                  className={`${tabClass(active === t.key)} flex-1 justify-center sm:flex-none`}
                >
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="tabular text-muted">{t.count}</span>
                </button>
              ))}
            </div>
            <IconButton
              label="Muat ulang"
              icon={IconRefresh}
              size={18}
              onClick={refresh}
              disabled={refreshing}
              className={refreshing ? "[&_svg]:animate-spin" : ""}
            />
          </div>
          <div className="relative mx-3 mb-1 sm:mx-4">
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              className={`${inputClass} pl-9`}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Cari kode di label atau nama pelanggan"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE_SIZE);
              }}
              aria-label="Cari cucian"
            />
          </div>
          {list.length === 0 ? (
            needle ? (
              <EmptyState icon={IconSearch} title="Tidak ditemukan">
                Tidak ada cucian aktif dengan kode atau nama itu. Cucian yang sudah siap diambil tidak
                tampil di antrean.
              </EmptyState>
            ) : (
              <p className="px-4 pb-5 pt-2 text-sm text-muted sm:px-5">
                {active === "working"
                  ? "Belum ada yang dikerjakan. Buka Berikutnya dan mulai dari urutan teratas."
                  : "Tidak ada cucian yang menunggu."}
              </p>
            )
          ) : (
            <>
              <ul className={tileListClass}>
                {list.slice(0, shown).map((o) => (
                  <WorkRow key={o.id} order={o} onStart={start} onFinish={setFinishing} />
                ))}
              </ul>
              {list.length > shown && (
                <div className="px-4 pb-4 sm:px-5">
                  <Button variant="secondary" className="w-full" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Tampilkan {Math.min(PAGE_SIZE, list.length - shown)} lagi
                    <span className="text-muted">· {list.length - shown} tersisa</span>
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
      <ReadyModal
        key={finishing?.id ?? "closed"}
        order={finishing}
        onClose={() => setFinishing(null)}
        onDone={async (order) => {
          setFinishing(null);
          toast(`${order.tracking_code} siap diambil${order.rack_location ? ` · rak ${order.rack_location}` : ""}`);
          await load();
        }}
      />
    </AppShell>
  );
}

function WorkRow({
  order: o,
  onStart,
  onFinish,
}: {
  order: WorkOrder;
  onStart: (o: WorkOrder) => Promise<void>;
  onFinish: (o: WorkOrder) => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timing = etaState({ ...o, ready_at: null }, now);
  const late = timing === "late";
  const urgent = isUrgent(o, now);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await onStart(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`${tileClass} grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_16rem] sm:items-center ${
        late ? "bg-danger-50/50" : ""
      }`}
    >
      <span
        className={`tabular display self-start pt-0.5 text-2xl leading-none text-faint`}
        aria-label={`Urutan ${o.queue_position}`}
      >
        {o.queue_position}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="serial text-lg font-semibold tracking-[0.08em] text-ink">{o.tracking_code}</span>
          {(urgent || late) && <UrgentBadge late={late} />}
          {o.is_express && <ExpressBadge />}
        </div>
        <p className="text-sm text-muted">{o.customer_name}</p>
        <ul className="mt-2 space-y-0.5 text-base text-ink-2">
          {o.items.map((item, i) => (
            <li key={i}>{itemLine(item)}</li>
          ))}
        </ul>
        {o.notes && (
          <p className="mt-2 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-700 ring-1 ring-inset ring-warn-600/20">
            <span className="font-semibold">Catatan:</span> {o.notes}
          </p>
        )}
        <p className={`mt-2 flex items-start gap-1.5 text-sm ${late ? "text-danger-700" : "text-muted"}`}>
          {late ? (
            <IconAlert size={14} className="mt-[3px] shrink-0" />
          ) : (
            <IconClock size={14} className="mt-[3px] shrink-0" />
          )}
          {late ? (
            <span>
              <span className="font-semibold">Terlambat</span> · janji {formatDateTime(o.promised_ready_at)}
            </span>
          ) : (
            <span className="tabular">
              Janji {formatDateTime(o.promised_ready_at)}
              {now > 0 && ` · ${relativeEta(o.promised_ready_at, now)}`}
            </span>
          )}
        </p>
        {o.status === "RECEIVED" && (
          <p className="tabular mt-1 pl-5 text-xs text-muted">
            Lama kerja {workDuration(o.processing_hours)}
            {o.slack_hours !== null && o.latest_start_at && !late && (
              <>
                {" · "}
                <span
                  title="Janji siap dikurangi lama kerja. Antrean diurutkan dari batas mulai yang paling dekat (Least Slack Time)."
                  className={o.slack_hours < 0 ? "font-medium text-danger-700" : urgent ? "font-medium text-warn-700" : ""}
                >
                  {startLabel(o)}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="col-start-2 sm:col-start-auto">
        {o.next_status === "PROCESSING" && (
          <Button variant="secondary" size="lg" className="w-full" loading={busy} onClick={start}>
            Mulai kerjakan
          </Button>
        )}
        {o.next_status === "READY" && (
          <Button size="lg" className="w-full" onClick={() => onFinish(o)}>
            <IconPackageCheck size={18} className="shrink-0" />
            Selesai, siap diambil
          </Button>
        )}
        <ErrorText message={error} />
      </div>
    </li>
  );
}

function ReadyModal({
  order,
  onClose,
  onDone,
}: {
  order: WorkOrder | null;
  onClose: () => void;
  onDone: (order: WorkOrder) => void;
}) {
  const [rack, setRack] = useState(order?.rack_location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<WorkOrder>(`/work/${order.id}/status`, {
        method: "POST",
        body: { to_status: "READY", rack_location: rack.trim() || null },
      });
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title="Cucian selesai"
      description={order ? `${order.tracking_code} · ${order.customer_name}. Pelanggan dapat WhatsApp otomatis.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={READY_FORM} loading={busy}>
            Tandai siap
          </Button>
        </>
      }
    >
      <form id={READY_FORM} className="space-y-4" onSubmit={submit}>
        <Field label="Lokasi rak" hint="Boleh dikosongkan. Mis. A3 atau B12, supaya kasir cepat menemukannya.">
          <input
            className={`${inputClass} font-mono uppercase`}
            value={rack}
            maxLength={20}
            autoFocus
            onChange={(e) => setRack(e.target.value)}
          />
        </Field>
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}
