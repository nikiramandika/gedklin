"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { IconCalendar, IconList } from "@/components/icons";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  SavedNote,
  Stepper,
  Switch,
  inputClass,
  textareaClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, todayLocalISO } from "@/lib/format";
import type { AppSettings, DailyOperation, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const RECENT_ROWS = 7;
// Urutan sama dengan API: 0 = Senin ... 6 = Minggu.
const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const WEEKDAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

const hhmm = (t: string) => t.slice(0, 5);

function weekdayOf(isoDate: string): number {
  return (new Date(`${isoDate}T12:00:00`).getDay() + 6) % 7;
}

function dayNames(days: number[]): string {
  const sorted = [...days].sort();
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length > 2 && contiguous) return `${WEEKDAY_NAMES[sorted[0]]}–${WEEKDAY_NAMES[sorted.at(-1)!]}`;
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

function describeWeek(closed: number[]): string {
  if (closed.length === 0) return "Buka setiap hari.";
  const open = WEEKDAYS.map((_, d) => d).filter((d) => !closed.includes(d));
  return `Buka ${dayNames(open)}, tutup ${dayNames(closed)}.`;
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

// Pengecualian baru diawali dari jadwal normal, supaya pemilik cukup mengubah yang berbeda.
function normalDay(date: string, s: AppSettings): DayForm {
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

function rowForm(row: DailyOperation): DayForm {
  return {
    date: row.date,
    is_open: row.is_open,
    staff_on_duty: String(row.staff_on_duty),
    washers_available: String(row.washers_available),
    dryers_available: String(row.dryers_available),
    open_time: hhmm(row.open_time),
    close_time: hhmm(row.close_time),
    machine_issue_note: row.machine_issue_note ?? "",
  };
}

export default function OperasionalPage() {
  return (
    <AppShell roles={ROLES}>
      <OperasionalContent />
    </AppShell>
  );
}

// Dirender hanya setelah login (di klien), jadi tanggal hari ini aman dibaca saat render.
function OperasionalContent() {
  const today = todayLocalISO();
  const [rows, setRows] = useState<DailyOperation[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<DayForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<DailyOperation[]>("/daily-operations?days=30")
        .then((r) => {
          setRows(r);
          setLoadError(null);
        })
        .catch((e: Error) => setLoadError(e.message)),
    [],
  );

  useEffect(() => {
    load();
    api<AppSettings>("/settings")
      .then(setSettings)
      .catch((e: Error) => setLoadError(e.message));
  }, [load]);

  // Formulir diisi setelah jadwal normal dan pengecualian termuat, supaya hari ini memakai data yang benar.
  if (!form && settings && rows) {
    const row = rows.find((r) => r.date === today);
    setForm(row ? rowForm(row) : normalDay(today, settings));
  }

  function set<K extends keyof DayForm>(key: K, value: DayForm[K]) {
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function edit(row: DailyOperation) {
    setSaved(false);
    setForm(rowForm(row));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Tanggal yang sudah punya pengecualian langsung dimuat, supaya simpan tidak menimpa dengan angka lama.
  function pickDate(date: string) {
    if (!settings) return;
    setSaved(false);
    const row = rows?.find((r) => r.date === date);
    setForm(row ? rowForm(row) : normalDay(date, settings));
  }

  function onNormalSaved(s: AppSettings) {
    setSettings(s);
    // Formulir pengecualian yang belum punya data ikut memakai jadwal normal yang baru.
    setForm((f) => (f && !rows?.some((r) => r.date === f.date) ? normalDay(f.date, s) : f));
  }

  async function saveException(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaved(false);
    setBusy(true);
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
          machine_issue_note: form.machine_issue_note || null,
        },
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Operasional Harian"
        description="Dipakai sistem untuk menghitung perkiraan siap dan batas janji. Atur jadwal normal sekali; catat pengecualian hanya bila suatu tanggal berbeda."
      />

      {loadError && (
        <div className="mb-5">
          <ErrorText message={loadError} />
        </div>
      )}

      {settings && rows && <TodayStatus today={today} rows={rows} settings={settings} onEdit={edit} />}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
        <div className="space-y-5">
          {settings ? <NormalScheduleCard settings={settings} onSaved={onNormalSaved} /> : <Loading rows={4} />}

          {settings && form && (
            <Card
              icon={IconCalendar}
              title="Catat pengecualian"
              description="Isi hanya bila tanggal tertentu berbeda dari jadwal normal: petugas izin, mesin rusak, libur, atau buka di hari tutup."
            >
              <form className="space-y-5" onSubmit={saveException}>
                <Field label="Tanggal" hint={dateHint(form.date, rows, settings)}>
                  <input
                    className={inputClass}
                    type="date"
                    value={form.date}
                    onChange={(e) => pickDate(e.target.value)}
                    required
                  />
                </Field>
                <Switch
                  label="Buka pada tanggal ini"
                  description={form.is_open ? "Outlet buka" : "Tutup · pekerjaan dan janji bergeser ke hari buka berikutnya"}
                  checked={form.is_open}
                  onChange={(v) => set("is_open", v)}
                />
                {form.is_open && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Jam buka">
                        <input
                          className={inputClass}
                          type="time"
                          value={form.open_time}
                          onChange={(e) => set("open_time", e.target.value)}
                          required
                        />
                      </Field>
                      <Field label="Jam tutup">
                        <input
                          className={inputClass}
                          type="time"
                          value={form.close_time}
                          onChange={(e) => set("close_time", e.target.value)}
                          required
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                      <Field label="Petugas" hint={lessHint(form.staff_on_duty, settings.default_staff_on_duty)}>
                        <Stepper label="petugas" value={form.staff_on_duty} onChange={(v) => set("staff_on_duty", v)} />
                      </Field>
                      <Field label="Mesin cuci" hint={lessHint(form.washers_available, settings.default_washers_available)}>
                        <Stepper label="mesin cuci" value={form.washers_available} onChange={(v) => set("washers_available", v)} />
                      </Field>
                      <Field label="Pengering" hint={lessHint(form.dryers_available, settings.default_dryers_available)}>
                        <Stepper label="pengering" value={form.dryers_available} onChange={(v) => set("dryers_available", v)} />
                      </Field>
                    </div>
                  </>
                )}
                <Field label="Catatan" hint="Mis. pengering 2 rusak, petugas izin, libur nasional.">
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={form.machine_issue_note}
                    onChange={(e) => set("machine_issue_note", e.target.value)}
                  />
                </Field>
                <ErrorText message={error} />
                <div className="flex items-center gap-4">
                  <Button type="submit" loading={busy}>
                    Simpan pengecualian
                  </Button>
                  <SavedNote show={saved} />
                </div>
              </form>
            </Card>
          )}
        </div>

        <ExceptionList rows={rows} settings={settings} selected={form?.date} onEdit={edit} />
      </div>
    </>
  );
}

function lessHint(value: string, normal: number): string | undefined {
  return Number(value) < normal ? `Normal ${normal}` : undefined;
}

function dateHint(date: string, rows: DailyOperation[] | null, s: AppSettings): string {
  if (rows?.some((r) => r.date === date)) return "Sudah ada pengecualian; menyimpan akan menimpanya.";
  return s.closed_weekdays.includes(weekdayOf(date))
    ? `Biasanya tutup (hari tutup rutin ${WEEKDAY_NAMES[weekdayOf(date)]}).`
    : "Belum ada pengecualian; saat ini mengikuti jadwal normal.";
}

function TodayStatus({
  today,
  rows,
  settings: s,
  onEdit,
}: {
  today: string;
  rows: DailyOperation[];
  settings: AppSettings;
  onEdit: (row: DailyOperation) => void;
}) {
  const row = rows.find((r) => r.date === today);
  const routineClosed = s.closed_weekdays.includes(weekdayOf(today));
  const open = row ? row.is_open : !routineClosed;
  const hours = row ? `${hhmm(row.open_time)}–${hhmm(row.close_time)}` : `${hhmm(s.default_open_time)}–${hhmm(s.default_close_time)}`;
  const staff = row ? row.staff_on_duty : s.default_staff_on_duty;
  const source = row ? "Pengecualian tercatat" : routineClosed ? "Hari tutup rutin" : "Mengikuti jadwal normal";

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card sm:px-5">
      <p className="text-sm text-ink-2">
        <span className="font-semibold text-ink">Hari ini, {formatDate(today)}</span>
        <span aria-hidden="true"> · </span>
        {open ? (
          <>
            Buka <span className="tabular">{hours}</span> · {staff} petugas
          </>
        ) : (
          "Tutup"
        )}
      </p>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
            row ? "bg-warn-50 text-warn-700 ring-warn-600/25" : "bg-subtle text-muted ring-line"
          }`}
        >
          {source}
        </span>
        {row && (
          <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>
            Ubah
          </Button>
        )}
      </div>
    </div>
  );
}

function NormalScheduleCard({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const initial = {
    closed: settings.closed_weekdays,
    open_time: hhmm(settings.default_open_time),
    close_time: hhmm(settings.default_close_time),
    staff: String(settings.default_staff_on_duty),
    washers: String(settings.default_washers_available),
    dryers: String(settings.default_dryers_available),
  };
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify({ ...v, closed: [...v.closed].sort() }) !== JSON.stringify({ ...initial, closed: [...initial.closed].sort() });
  const allClosed = v.closed.length >= 7;

  function update<K extends keyof typeof v>(key: K, value: (typeof v)[K]) {
    setSaved(false);
    setV((cur) => ({ ...cur, [key]: value }));
  }

  function toggle(d: number) {
    update("closed", v.closed.includes(d) ? v.closed.filter((x) => x !== d) : [...v.closed, d].sort());
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<AppSettings>("/settings", {
        method: "PUT",
        body: {
          closed_weekdays: v.closed,
          default_open_time: v.open_time,
          default_close_time: v.close_time,
          default_staff_on_duty: Number(v.staff),
          default_washers_available: Number(v.washers),
          default_dryers_available: Number(v.dryers),
        },
      });
      onSaved(res);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      icon={IconCalendar}
      tone="neutral"
      title="Jadwal normal"
      description="Berlaku otomatis setiap hari. Cukup diatur sekali dan diubah bila jadwal outlet berubah."
    >
      <div className="space-y-5">
        <Field label="Hari buka" hint={allClosed ? undefined : describeWeek(v.closed)}>
          <div role="group" aria-label="Hari buka" className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((label, d) => {
              const open = !v.closed.includes(d);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={open}
                  title={`${WEEKDAY_NAMES[d]}: ${open ? "buka" : "tutup"}`}
                  onClick={() => toggle(d)}
                  className={`h-10 rounded-lg text-sm font-medium ring-1 ring-inset transition-colors duration-150 pointer-coarse:h-11 ${
                    open
                      ? "bg-brand-600 text-white ring-brand-600 hover:bg-brand-700"
                      : "bg-subtle text-faint line-through ring-line hover:text-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>
        {allClosed && <ErrorText message="Minimal satu hari harus buka." />}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Jam buka">
            <input className={inputClass} type="time" value={v.open_time} onChange={(e) => update("open_time", e.target.value)} />
          </Field>
          <Field label="Jam tutup">
            <input className={inputClass} type="time" value={v.close_time} onChange={(e) => update("close_time", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <Field label="Petugas">
            <Stepper label="petugas" value={v.staff} onChange={(x) => update("staff", x)} />
          </Field>
          <Field label="Mesin cuci">
            <Stepper label="mesin cuci" value={v.washers} onChange={(x) => update("washers", x)} />
          </Field>
          <Field label="Pengering">
            <Stepper label="pengering" value={v.dryers} onChange={(x) => update("dryers", x)} />
          </Field>
        </div>
        <ErrorText message={error} />
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={save} loading={busy} disabled={!changed || allClosed}>
            Simpan jadwal normal
          </Button>
          <SavedNote show={saved && !changed} />
        </div>
      </div>
    </Card>
  );
}

function ExceptionList({
  rows,
  settings: s,
  selected,
  onEdit,
}: {
  rows: DailyOperation[] | null;
  settings: AppSettings | null;
  selected?: string;
  onEdit: (row: DailyOperation) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = rows && (showAll ? rows : rows.slice(0, RECENT_ROWS));
  // Nilai yang berbeda dari jadwal normal ditandai, supaya terlihat apa yang membuat hari itu khusus.
  const diff = (differs: boolean) => (differs ? "font-semibold text-warn-700" : "");

  return (
    <Card
      flush
      icon={IconList}
      tone="neutral"
      title="Riwayat pengecualian"
      description="30 hari terakhir. Nilai yang berbeda dari jadwal normal ditandai warna."
    >
      {!rows || !s ? (
        <Loading rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState icon={IconCalendar} title="Belum ada pengecualian">
          Semua hari mengikuti jadwal normal.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto px-3 pb-3 sm:px-4 sm:pb-4">
          <table className="w-full min-w-[560px] border-separate border-spacing-y-1.5 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-muted">
                <th className="px-4 py-1.5 font-medium">Tanggal</th>
                <th className="px-3 py-1.5 font-medium">Jam</th>
                <th className="px-3 py-1.5 font-medium">Petugas</th>
                <th className="px-3 py-1.5 font-medium">Cuci / Kering</th>
                <th className="px-3 py-1.5 font-medium">Catatan</th>
                <th className="px-4 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {shown!.map((r) => {
                const normallyOpen = !s.closed_weekdays.includes(weekdayOf(r.date));
                const hoursDiffer =
                  hhmm(r.open_time) !== hhmm(s.default_open_time) || hhmm(r.close_time) !== hhmm(s.default_close_time);
                return (
                  <tr
                    key={r.date}
                    className={`[&>td]:py-3 [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl ${
                      selected === r.date ? "[&>td]:bg-brand-50" : "[&>td]:bg-subtle hover:[&>td]:bg-tint"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 font-medium text-ink">{formatDate(r.date)}</td>
                    <td className="tabular whitespace-nowrap px-3">
                      {r.is_open ? (
                        <span className={diff(!normallyOpen || hoursDiffer)}>
                          {hhmm(r.open_time)}–{hhmm(r.close_time)}
                        </span>
                      ) : (
                        <span className={normallyOpen ? diff(true) : "font-medium text-muted"}>Tutup</span>
                      )}
                    </td>
                    <td className="tabular px-3">
                      {r.is_open ? <span className={diff(r.staff_on_duty !== s.default_staff_on_duty)}>{r.staff_on_duty}</span> : "–"}
                    </td>
                    <td className="tabular px-3">
                      {r.is_open ? (
                        <>
                          <span className={diff(r.washers_available !== s.default_washers_available)}>{r.washers_available}</span>
                          {" / "}
                          <span className={diff(r.dryers_available !== s.default_dryers_available)}>{r.dryers_available}</span>
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="max-w-[240px] truncate px-3 text-muted">{r.machine_issue_note ?? "–"}</td>
                    <td className="px-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>
                        Ubah
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > RECENT_ROWS && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full"
              aria-expanded={showAll}
              onClick={() => setShowAll((x) => !x)}
            >
              {showAll ? `Tampilkan ${RECENT_ROWS} terbaru` : `Tampilkan semua (${rows.length})`}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
