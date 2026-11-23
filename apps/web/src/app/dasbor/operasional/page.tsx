"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@/components/icons";
import { Drawer, useToast } from "@/components/overlay";
import {
  Button,
  Card,
  ErrorText,
  Field,
  IconButton,
  Kpi,
  Loading,
  PageHeader,
  Segmented,
  Stepper,
  buttonClass,
  cardClass,
  inputClass,
  textareaClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { todayLocalISO } from "@/lib/format";
import { WEEKDAYS, hhmm } from "@/lib/schedule";
import type { AppSettings, DailyOperation, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const DAYS_SHOWN = 14;
// API memuat catatan sejak 35 hari lalu; navigasi mundur dibatasi agar data selalu ada.
const MAX_WEEKS_BACK = 4;
const FORM_ID = "daily-operation-form";

/* ---------- Tanggal & jam ---------- */

const asDate = (iso: string) => new Date(`${iso}T12:00:00`);
const weekdayOf = (iso: string) => (asDate(iso).getDay() + 6) % 7;
// Jam ditulis 08.00 seperti di bagian lain aplikasi.
const clock = (t: string) => hhmm(t).replace(":", ".");

function addDays(iso: string, n: number): string {
  const d = asDate(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fmtLong = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("id-ID", { month: "short" });

/* ---------- Isi satu hari ---------- */

type Day = {
  date: string;
  open: boolean;
  hours: string;
  hoursDiffer: boolean;
  special: boolean;
  staff: number;
  washers: number;
  dryers: number;
  diffs: string[];
  note: string | null;
};

function dayOf(date: string, rows: DailyOperation[], s: AppSettings): Day {
  const row = rows.find((r) => r.date === date);
  const normalHours = `${clock(s.default_open_time)}–${clock(s.default_close_time)}`;
  if (!row) {
    return {
      date,
      open: !s.closed_weekdays.includes(weekdayOf(date)),
      hours: normalHours,
      hoursDiffer: false,
      special: false,
      staff: s.default_staff_on_duty,
      washers: s.default_washers_available,
      dryers: s.default_dryers_available,
      diffs: [],
      note: null,
    };
  }
  // Hanya yang berbeda dari jadwal normal, supaya alasan hari itu khusus langsung terbaca.
  const diffs: string[] = [];
  if (row.is_open) {
    if (row.staff_on_duty !== s.default_staff_on_duty) diffs.push(`${row.staff_on_duty} petugas`);
    if (row.washers_available !== s.default_washers_available) diffs.push(`${row.washers_available} mesin cuci`);
    if (row.dryers_available !== s.default_dryers_available) diffs.push(`${row.dryers_available} pengering`);
  }
  const hours = `${clock(row.open_time)}–${clock(row.close_time)}`;
  return {
    date,
    open: row.is_open,
    hours,
    hoursDiffer: hours !== normalHours,
    special: true,
    staff: row.staff_on_duty,
    washers: row.washers_available,
    dryers: row.dryers_available,
    diffs,
    note: row.machine_issue_note,
  };
}

function summary(d: Day): string {
  if (!d.open) return d.note ? `Tutup · ${d.note}` : "Tutup";
  return [`Buka ${d.hours}`, ...d.diffs].join(" · ");
}

type DayForm = {
  date: string;
  is_open: boolean;
  staff_on_duty: string;
  washers_available: string;
  dryers_available: string;
  open_time: string;
  close_time: string;
  machine_issue_note: string;
};

function formFor(date: string, rows: DailyOperation[], s: AppSettings): DayForm {
  const row = rows.find((r) => r.date === date);
  if (row) {
    return {
      date,
      is_open: row.is_open,
      staff_on_duty: String(row.staff_on_duty),
      washers_available: String(row.washers_available),
      dryers_available: String(row.dryers_available),
      open_time: hhmm(row.open_time),
      close_time: hhmm(row.close_time),
      machine_issue_note: row.machine_issue_note ?? "",
    };
  }
  return {
    date,
    is_open: !s.closed_weekdays.includes(weekdayOf(date)),
    staff_on_duty: String(s.default_staff_on_duty),
    washers_available: String(s.default_washers_available),
    dryers_available: String(s.default_dryers_available),
    open_time: hhmm(s.default_open_time),
    close_time: hhmm(s.default_close_time),
    machine_issue_note: "",
  };
}

/* ---------- Halaman ---------- */

export default function OperasionalPage() {
  return (
    <AppShell roles={ROLES}>
      <JadwalContent />
    </AppShell>
  );
}

// Dirender hanya setelah login (di klien), jadi tanggal hari ini aman dibaca saat render.
function JadwalContent() {
  const today = todayLocalISO();
  const thisMonday = addDays(today, -weekdayOf(today));
  const toast = useToast();
  const [rows, setRows] = useState<DailyOperation[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  // pickDate: dibuka dari tombol "Catat", jadi tanggal masih bisa dipilih di panel.
  const [editing, setEditing] = useState<{ date: string; pickDate: boolean } | null>(null);

  const load = useCallback(
    () =>
      api<DailyOperation[]>("/daily-operations?days=35")
        .then((r) => {
          setRows(r);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
    api<AppSettings>("/settings")
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, [load]);

  const ready = settings && rows;
  const start = addDays(thisMonday, weekOffset * 7);
  const end = addDays(start, DAYS_SHOWN - 1);
  const days = ready ? Array.from({ length: DAYS_SHOWN }, (_, i) => dayOf(addDays(start, i), rows, settings)) : null;
  const later = ready
    ? rows
        .filter((r) => r.date > end)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => dayOf(r.date, rows, settings))
    : [];
  const pick = (date: string) => setEditing({ date, pickDate: false });

  return (
    <>
      <PageHeader
        title="Jadwal Outlet"
        description="Jam buka, petugas, dan mesin setiap hari."
        actions={
          <>
            <Link href="/pengaturan#jadwal" className={buttonClass("secondary")}>
              Jadwal normal
            </Link>
            <Button onClick={() => setEditing({ date: today, pickDate: true })} disabled={!ready}>
              <IconPlus size={18} />
              Catat libur / perubahan
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorText message={error} />
        </div>
      )}

      {!days || !settings ? (
        !error && (
          <div className={cardClass}>
            <Loading rows={6} />
          </div>
        )
      ) : (
        <div className="space-y-5">
          <TodayKpis day={dayOf(today, rows!, settings)} settings={settings} />

          <Card
            title="Kalender"
            description={`${fmtShort.format(asDate(start))} – ${fmtShort.format(asDate(end))} ${asDate(end).getFullYear()}`}
            action={
              <>
                {weekOffset !== 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
                    Minggu ini
                  </Button>
                )}
                <IconButton
                  label="Dua minggu sebelumnya"
                  icon={IconChevronLeft}
                  disabled={weekOffset <= -MAX_WEEKS_BACK}
                  onClick={() => setWeekOffset((w) => w - 2)}
                />
                <IconButton
                  label="Dua minggu berikutnya"
                  icon={IconChevronRight}
                  onClick={() => setWeekOffset((w) => w + 2)}
                />
              </>
            }
          >
            <CalendarGrid days={days} today={today} onPick={pick} />
            <DayList days={days} today={today} onPick={pick} />

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-sm text-muted">
              <Legend swatch="bg-warn-50 ring-1 ring-warn-600/60" label="Hari khusus" />
              <Legend swatch="bg-line ring-1 ring-line-strong" label="Tutup" />
              <Legend swatch="bg-surface ring-2 ring-brand-600" label="Hari ini" />
              <span className="sm:ml-auto">Klik tanggal untuk mengubah.</span>
            </div>
          </Card>

          {later.length > 0 && (
            <Card title="Tanggal berikutnya" description="Sudah dicatat, di luar kalender di atas.">
              <ul className="divide-y divide-line">
                {later.map((d) => (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => pick(d.date)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-subtle"
                    >
                      <span className="font-medium text-ink first-letter:uppercase">{fmtLong.format(asDate(d.date))}</span>
                      <span className="text-muted">{summary(d)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {editing && settings && rows && (
        <DayDrawer
          key={editing.date}
          initial={formFor(editing.date, rows, settings)}
          special={rows.some((r) => r.date === editing.date)}
          pickDate={editing.pickDate}
          settings={settings}
          onPickDate={(date) => setEditing({ date, pickDate: true })}
          onClose={() => setEditing(null)}
          onDone={async (message) => {
            setEditing(null);
            toast(message);
            await load();
          }}
        />
      )}
    </>
  );
}

/* ---------- Hari ini ---------- */

// Deretan angka seperti di Dasbor; keterangan hanya muncul bila berbeda dari biasanya.
function TodayKpis({ day: d, settings: s }: { day: Day; settings: AppSettings }) {
  const count = (label: string, value: number, normal: number) => (
    <Kpi
      label={label}
      value={d.open ? String(value) : "–"}
      sub={d.open && value !== normal ? `biasanya ${normal}` : undefined}
      warn={d.open && value < normal}
    />
  );
  return (
    <section aria-label="Hari ini" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Kpi
        label={`Hari ini, ${fmtShort.format(asDate(d.date))}`}
        value={d.open ? d.hours : "Tutup"}
        sub={d.special ? d.note || "Hari khusus" : "Jadwal normal"}
        warn={d.special}
      />
      {count("Petugas", d.staff, s.default_staff_on_duty)}
      {count("Mesin cuci", d.washers, s.default_washers_available)}
      {count("Pengering", d.dryers, s.default_dryers_available)}
    </section>
  );
}

/* ---------- Kalender ---------- */

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-3.5 w-3.5 rounded ${swatch}`} />
      {label}
    </span>
  );
}

function cellTone(d: Day, today: string): string {
  const base = d.special
    ? "bg-warn-50 ring-1 ring-inset ring-warn-600/40 hover:ring-warn-600/70"
    : d.open
      ? "bg-surface ring-1 ring-inset ring-line hover:ring-brand-600/50"
      : "bg-line/60 ring-1 ring-inset ring-line hover:ring-line-strong";
  const todayRing = d.date === today ? "outline-2 outline-offset-1 outline-brand-600" : "";
  const past = d.date < today ? "opacity-55 hover:opacity-100" : "";
  return `${base} ${todayRing} ${past}`;
}

// Hari normal cukup "Buka" supaya hari tutup dan hari khusus menonjol; jam hanya ditulis bila berbeda.
function CellStatus({ d }: { d: Day }) {
  if (!d.open) return <span className="text-sm font-semibold text-ink-2">Tutup</span>;
  if (d.hoursDiffer) return <span className="tabular text-sm font-semibold text-warn-700">{d.hours}</span>;
  return <span className="text-sm text-muted">Buka</span>;
}

// Desktop & tablet: kalender 7 kolom, Senin di kiri seperti kalender dinding.
function CalendarGrid({ days, today, onPick }: { days: Day[]; today: string; onPick: (date: string) => void }) {
  return (
    <div className="hidden md:block">
      <div className="mb-1.5 grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const date = asDate(d.date);
          const isToday = d.date === today;
          return (
            <li key={d.date}>
              <button
                type="button"
                onClick={() => onPick(d.date)}
                aria-label={`${fmtLong.format(date)}: ${summary(d)}${d.special ? " (hari khusus)" : ""}`}
                className={`flex h-full min-h-[4.75rem] w-full flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-left transition-[box-shadow,opacity] duration-150 ${cellTone(d, today)}`}
              >
                <span className="flex w-full items-baseline justify-between gap-1">
                  <span className={`tabular text-base font-semibold ${isToday ? "text-brand-700" : "text-ink"}`}>
                    {date.getDate()}
                    {date.getDate() === 1 && <span className="ml-1 text-xs font-medium text-muted">{fmtMonth.format(date)}</span>}
                  </span>
                  {isToday && <span className="text-[11px] font-semibold text-brand-700">Hari ini</span>}
                </span>
                <CellStatus d={d} />
                {d.diffs.map((x) => (
                  <span key={x} className="text-xs font-medium text-warn-700">
                    {x}
                  </span>
                ))}
                {d.note && <span className="line-clamp-1 text-xs text-muted">{d.note}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// HP: kalender 7 kolom terlalu sempit, jadi tampil sebagai daftar per hari.
function DayList({ days, today, onPick }: { days: Day[]; today: string; onPick: (date: string) => void }) {
  return (
    <ol className="space-y-1.5 md:hidden">
      {days.map((d) => {
        const isToday = d.date === today;
        const extra = [...d.diffs, d.note].filter(Boolean).join(" · ");
        return (
          <li key={d.date}>
            <button
              type="button"
              onClick={() => onPick(d.date)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-[box-shadow,opacity] duration-150 ${cellTone(d, today)}`}
            >
              <span className="w-10 shrink-0 text-center leading-tight">
                <span className="block text-xs font-medium text-muted">{WEEKDAYS[weekdayOf(d.date)]}</span>
                <span className={`tabular block text-lg font-semibold ${isToday ? "text-brand-700" : "text-ink"}`}>
                  {asDate(d.date).getDate()}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <CellStatus d={d} />
                  {isToday && <span className="text-xs font-semibold text-brand-700">Hari ini</span>}
                </span>
                {extra && <span className="block truncate text-xs font-medium text-warn-700">{extra}</span>}
              </span>
              <IconChevronRight size={16} className="shrink-0 text-faint" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Panel ubah satu hari ---------- */

function DayDrawer({
  initial,
  special,
  pickDate,
  settings: s,
  onPickDate,
  onClose,
  onDone,
}: {
  initial: DayForm;
  special: boolean;
  pickDate: boolean;
  settings: AppSettings;
  onPickDate: (date: string) => void;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = fmtLong.format(asDate(form.date));

  function set<K extends keyof DayForm>(key: K, value: DayForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const usual = (value: string, normal: number) => (Number(value) !== normal ? `Biasanya ${normal}` : undefined);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("save");
    try {
      await api(`/daily-operations/${form.date}`, {
        method: "PUT",
        body: {
          is_open: form.is_open,
          staff_on_duty: Number(form.staff_on_duty),
          washers_available: Number(form.washers_available),
          dryers_available: Number(form.dryers_available),
          open_time: form.open_time,
          close_time: form.close_time,
          machine_issue_note: form.machine_issue_note.trim() || null,
        },
      });
      await onDone("Jadwal disimpan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
      setBusy(null);
    }
  }

  async function reset() {
    setError(null);
    setBusy("reset");
    try {
      await api(`/daily-operations/${form.date}`, { method: "DELETE" });
      await onDone("Kembali ke jadwal normal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
      setBusy(null);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={pickDate ? "Catat libur / perubahan" : <span className="first-letter:uppercase">{label}</span>}
      description={special ? "Hari khusus" : "Saat ini mengikuti jadwal normal"}
      footer={
        <>
          {special && (
            <Button variant="ghost" className="mr-auto" loading={busy === "reset"} disabled={!!busy} onClick={reset}>
              Kembalikan ke normal
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>
            Batal
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy === "save"} disabled={!!busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="space-y-5 pt-1" onSubmit={save}>
        {pickDate && (
          <Field label="Tanggal">
            <input
              className={inputClass}
              type="date"
              value={form.date}
              required
              onChange={(e) => e.target.value && onPickDate(e.target.value)}
            />
          </Field>
        )}

        <div>
          <span className="label-caps mb-1.5 block">Outlet</span>
          <Segmented<"open" | "closed">
            label="Outlet buka atau tutup"
            size="lg"
            value={form.is_open ? "open" : "closed"}
            onChange={(v) => set("is_open", v === "open")}
            options={[
              { value: "open", label: "Buka" },
              { value: "closed", label: "Tutup" },
            ]}
          />
        </div>

        {form.is_open && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Jam buka">
                <input className={inputClass} type="time" value={form.open_time} required onChange={(e) => set("open_time", e.target.value)} />
              </Field>
              <Field label="Jam tutup">
                <input className={inputClass} type="time" value={form.close_time} required onChange={(e) => set("close_time", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Petugas" hint={usual(form.staff_on_duty, s.default_staff_on_duty)}>
                <Stepper label="petugas" value={form.staff_on_duty} onChange={(v) => set("staff_on_duty", v)} />
              </Field>
              <Field label="Mesin cuci" hint={usual(form.washers_available, s.default_washers_available)}>
                <Stepper label="mesin cuci" value={form.washers_available} onChange={(v) => set("washers_available", v)} />
              </Field>
              <Field label="Pengering" hint={usual(form.dryers_available, s.default_dryers_available)}>
                <Stepper label="pengering" value={form.dryers_available} onChange={(v) => set("dryers_available", v)} />
              </Field>
            </div>
          </>
        )}

        <Field label="Catatan (opsional)">
          <textarea
            className={textareaClass}
            rows={2}
            maxLength={500}
            placeholder={form.is_open ? "Contoh: pengering 2 rusak" : "Contoh: libur Natal"}
            value={form.machine_issue_note}
            onChange={(e) => set("machine_issue_note", e.target.value)}
          />
        </Field>

        <ErrorText message={error} />
      </form>
    </Drawer>
  );
}
