"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import {
  IconBolt,
  IconCalendar,
  IconChevronRight,
  IconHistory,
  IconKey,
  IconReceipt,
  IconSearch,
  IconTag,
  IconUser,
  IconUsers,
  IconX,
} from "@/components/icons";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  IconButton,
  Loading,
  PageHeader,
  Select,
  inputClass,
  tileClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatRupiah } from "@/lib/format";
import type { ActivityEntity, ActivityLog, Role, User } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const PAGE_SIZE = 50;
const TZ = "Asia/Jakarta";

const CATEGORIES: { key: ActivityEntity | "all"; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "order", label: "Pesanan" },
  { key: "customer", label: "Pelanggan" },
  { key: "catalog", label: "Layanan" },
  { key: "user", label: "Akun" },
  { key: "settings", label: "Pengaturan" },
  { key: "operation", label: "Operasional" },
  { key: "auth", label: "Login" },
];

const ENTITY_STYLE: Record<ActivityEntity, { icon: typeof IconTag; tone: string }> = {
  order: { icon: IconReceipt, tone: "bg-brand-50 text-brand-600 ring-brand-100" },
  customer: { icon: IconUser, tone: "bg-brand-50 text-brand-600 ring-brand-100" },
  catalog: { icon: IconTag, tone: "bg-ok-50 text-ok-700 ring-ok-600/15" },
  user: { icon: IconUsers, tone: "bg-canvas text-ink-2 ring-line" },
  settings: { icon: IconBolt, tone: "bg-warn-50 text-warn-700 ring-warn-600/15" },
  operation: { icon: IconCalendar, tone: "bg-canvas text-ink-2 ring-line" },
  auth: { icon: IconKey, tone: "bg-canvas text-muted ring-line" },
};

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  pembayaran: "Pembayaran",
  catatan: "Catatan",
  rak: "Lokasi rak",
  isi: "Isi pesanan",
  total: "Total",
  nama: "Nama",
  no_wa: "No. WhatsApp",
  name: "Nama",
  group: "Kelompok",
  process: "Proses",
  unit: "Satuan harga",
  price: "Harga",
  extra_price: "Tambahan",
  base_kg: "Berat dasar (kg)",
  min_qty: "Minimal",
  kg_per_load: "Kapasitas per load (kg)",
  pcs_per_load: "Kapasitas per load (pcs)",
  max_extra: "Maks tambahan",
  express_eligible: "Bisa Express",
  is_active: "Aktif",
  role: "Peran",
  regular_hours: "Janji Reguler (jam)",
  express_hours: "Janji Express (jam)",
  min_regular_hours: "Batas bawah Reguler (jam)",
  express_multiplier: "Pengali Express",
  machine_capacity_kg: "Kapasitas mesin (kg)",
  default_promise_hours: "Janji default (jam)",
  default_staff_on_duty: "Petugas default",
  default_washers_available: "Mesin cuci default",
  default_dryers_available: "Pengering default",
  default_open_time: "Jam buka default",
  default_close_time: "Jam tutup default",
  is_open: "Buka",
  staff_on_duty: "Petugas",
  washers_available: "Mesin cuci",
  dryers_available: "Pengering",
  open_time: "Jam buka",
  close_time: "Jam tutup",
  machine_issue_note: "Catatan mesin",
};
const MONEY_FIELDS = new Set(["price", "extra_price", "total"]);

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (MONEY_FIELDS.has(field) && typeof value === "number") return formatRupiah(value);
  if (typeof value === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5);
  return String(value);
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Hari ini";
  if (key === yesterday) return "Kemarin";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${key}T12:00:00+07:00`));
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export default function LogPage() {
  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Log Aktivitas"
        description="Siapa melakukan apa dan kapan: pesanan, perubahan layanan dan harga, akun, pengaturan, dan login."
      />
      {/* useSearchParams perlu Suspense agar halaman tetap bisa di-prerender. */}
      <Suspense
        fallback={
          <Card flush>
            <Loading rows={6} />
          </Card>
        }
      >
        <LogContent />
      </Suspense>
    </AppShell>
  );
}

/** Pencarian disimpan di URL (?q=KODE) supaya bisa dibuka dari detail pesanan dan dibagikan. */
function SearchBox({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <div className="relative min-w-0 flex-1">
        <IconSearch
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          className={`${inputClass} pl-10 ${draft ? "pr-11" : ""}`}
          type="search"
          enterKeyHint="search"
          placeholder="Kode pesanan, nama pelanggan, atau nama layanan"
          aria-label="Cari di log aktivitas"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {draft && (
          <IconButton
            label="Hapus pencarian"
            icon={IconX}
            size={16}
            className="absolute right-0 top-0"
            onClick={() => {
              setDraft("");
              onSearch("");
            }}
          />
        )}
      </div>
      <Button type="submit">Cari</Button>
    </form>
  );
}

function LogContent() {
  const router = useRouter();
  const q = useSearchParams().get("q")?.trim() ?? "";
  const [category, setCategory] = useState<ActivityEntity | "all">("all");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [entries, setEntries] = useState<ActivityLog[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (beforeId?: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (category !== "all") params.set("entity_type", category);
      if (userId) params.set("user_id", userId);
      if (q) params.set("q", q);
      if (beforeId) params.set("before_id", String(beforeId));
      return api<ActivityLog[]>(`/activity-logs?${params}`);
    },
    [category, userId, q],
  );

  function search(value: string) {
    setEntries(null);
    // Kode pesanan bisa berisi aktivitas apa saja, jadi filter kategori dilepas.
    if (value) setCategory("all");
    router.replace(value ? `/dasbor/log?q=${encodeURIComponent(value)}` : "/dasbor/log");
  }

  useEffect(() => {
    api<User[]>("/users")
      .then(setUsers)
      .catch(() => {
        /* filter petugas opsional */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPage()
      .then((page) => {
        if (cancelled) return;
        setEntries(page);
        setHasMore(page.length === PAGE_SIZE);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!entries?.length) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(entries[entries.length - 1].id);
      setEntries([...entries, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat");
    } finally {
      setLoadingMore(false);
    }
  }

  // Hasil pencarian yang sudah termuat semua dibaca berurutan dari awal, seperti alur prosesnya.
  const chronological = q !== "" && !hasMore;
  const shown = chronological ? [...(entries ?? [])].reverse() : (entries ?? []);
  const groups: { key: string; items: ActivityLog[] }[] = [];
  for (const e of shown) {
    const key = dayKey(e.created_at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(e);
    else groups.push({ key, items: [e] });
  }

  return (
    <Card flush>
      <div className="space-y-3 p-3 sm:p-4">
        <SearchBox key={q} initial={q} onSearch={search} />
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Jenis aktivitas"
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl bg-canvas p-1"
          >
            {CATEGORIES.map((c) => {
              const active = c.key === category;
              return (
                <button
                  key={c.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setEntries(null);
                    setCategory(c.key);
                  }}
                  className={`inline-flex h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                    active ? "bg-surface text-brand-700 shadow-tile" : "text-muted hover:bg-surface/70 hover:text-ink"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <Select
            className="w-full sm:w-52"
            aria-label="Filter petugas"
            value={userId}
            onChange={(e) => {
              setEntries(null);
              setUserId(e.target.value);
            }}
          >
            <option value="">Semua petugas</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        {q && entries !== null && (
          <p className="px-1 text-sm text-muted" aria-live="polite">
            {entries.length === 0 ? "Tidak ada" : `${entries.length}${hasMore ? "+" : ""}`} aktivitas untuk{" "}
            <span className="font-medium text-ink">&ldquo;{q}&rdquo;</span>
            {chronological && entries.length > 1 && ", diurutkan dari yang paling awal"}
          </p>
        )}
      </div>

      {error && (
        <div className="px-4 pb-3 sm:px-5">
          <ErrorText message={error} />
        </div>
      )}

      {entries === null ? (
        !error && <Loading rows={6} />
      ) : entries.length === 0 ? (
        q ? (
          <EmptyState icon={IconSearch} title="Tidak ditemukan">
            Periksa kode pesanan di nota. Aktivitas pesanan dicatat sejak fitur log aktif, jadi pesanan
            yang lebih lama hanya punya riwayat status di detail pesanan.
          </EmptyState>
        ) : (
          <EmptyState icon={IconHistory} title="Belum ada aktivitas">
            Aktivitas petugas akan muncul di sini setelah ada pesanan atau perubahan pengaturan.
          </EmptyState>
        )
      ) : (
        <div className="space-y-6 px-3 pb-4 sm:px-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">{dayLabel(g.key)}</h2>
              <ol className="space-y-2">
                {g.items.map((e) => (
                  <LogEntry key={e.id} entry={e} />
                ))}
              </ol>
            </section>
          ))}
          {hasMore && (
            <Button variant="secondary" className="w-full" loading={loadingMore} onClick={loadMore}>
              Muat lebih banyak
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function LogEntry({ entry: e }: { entry: ActivityLog }) {
  const [open, setOpen] = useState(false);
  const style = ENTITY_STYLE[e.entity_type] ?? ENTITY_STYLE.settings;
  const Icon = style.icon;
  const changes = e.changes ? Object.entries(e.changes) : [];

  return (
    <li className={`${tileClass} p-3.5`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${style.tone}`}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-ink text-pretty">{e.summary}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            <span className="font-medium text-ink-2">{e.user_name ?? "Sistem"}</span>
            {" · "}
            <time dateTime={e.created_at} className="tabular">
              {timeLabel(e.created_at)}
            </time>
          </p>
        </div>
        {changes.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-brand-700 transition-colors duration-150 hover:bg-brand-50"
          >
            {open ? "Tutup" : `${changes.length} perubahan`}
            <IconChevronRight
              size={16}
              className={`transition-transform duration-150 ${open ? "-rotate-90" : "rotate-90"}`}
            />
          </button>
        )}
      </div>
      {open && (
        <dl className="mt-3 space-y-1.5 rounded-xl bg-subtle p-3 text-sm sm:ml-12">
          {changes.map(([field, [before, after]]) => (
            <div key={field} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="text-muted">{FIELD_LABEL[field] ?? field}</dt>
              <dd className="tabular flex flex-wrap items-center gap-1.5">
                <span className="text-muted line-through decoration-faint">{formatValue(field, before)}</span>
                <IconChevronRight size={14} className="text-faint" />
                <span className="font-medium text-ink">{formatValue(field, after)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
