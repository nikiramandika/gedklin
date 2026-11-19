"use client";

import { useCallback, useEffect, useState } from "react";

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

export default function OperasionalPage() {
  return (
    <AppShell roles={ROLES}>
      <OperasionalContent />
    </AppShell>
  );
}

// Dirender hanya setelah login (di klien), jadi tanggal hari ini aman dibaca saat render.
function OperasionalContent() {
  const [rows, setRows] = useState<DailyOperation[] | null>(null);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [form, setForm] = useState({
    date: todayLocalISO(),
    is_open: true,
    staff_on_duty: "2",
    washers_available: "4",
    dryers_available: "3",
    open_time: "08:00",
    close_time: "17:00",
    machine_issue_note: "",
  });
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
      .then((s) => {
        setDefaults(s);
        setForm((f) => ({
          ...f,
          staff_on_duty: String(s.default_staff_on_duty),
          washers_available: String(s.default_washers_available),
          dryers_available: String(s.default_dryers_available),
          open_time: s.default_open_time.slice(0, 5),
          close_time: s.default_close_time.slice(0, 5),
        }));
      })
      .catch(() => {});
  }, [load]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  function edit(row: DailyOperation, scroll = true) {
    setSaved(false);
    setForm({
      date: row.date,
      is_open: row.is_open,
      staff_on_duty: String(row.staff_on_duty),
      washers_available: String(row.washers_available),
      dryers_available: String(row.dryers_available),
      open_time: row.open_time.slice(0, 5),
      close_time: row.close_time.slice(0, 5),
      machine_issue_note: row.machine_issue_note ?? "",
    });
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Tanggal yang sudah punya data langsung dimuat, supaya simpan tidak menimpa dengan angka lama di formulir.
  function pickDate(date: string) {
    const row = rows?.find((r) => r.date === date);
    if (row) edit(row, false);
    else set("date", date);
  }

  const below = (value: string, normal: number | undefined) =>
    normal !== undefined && Number(value) < normal;

  return (
    <>
      <PageHeader
        title="Operasional Harian"
        description="Dipakai untuk perkiraan waktu siap."
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        <Card icon={IconCalendar} title="Isi data hari" description="Tanggal sama akan ditimpa.">
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
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
            }}
          >
            <Field label="Tanggal">
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
              description={form.is_open ? "Outlet buka" : "Tutup · pesanan bergeser ke besok"}
              checked={form.is_open}
              onChange={(v) => set("is_open", v)}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <Field
                label="Petugas"
                hint={below(form.staff_on_duty, defaults?.default_staff_on_duty) ? "Kurang dari normal" : undefined}
              >
                <Stepper label="petugas" value={form.staff_on_duty} onChange={(v) => set("staff_on_duty", v)} />
              </Field>
              <Field
                label="Mesin cuci"
                hint={below(form.washers_available, defaults?.default_washers_available) ? "Kurang dari normal" : undefined}
              >
                <Stepper label="mesin cuci" value={form.washers_available} onChange={(v) => set("washers_available", v)} />
              </Field>
              <Field
                label="Pengering"
                hint={below(form.dryers_available, defaults?.default_dryers_available) ? "Kurang dari normal" : undefined}
              >
                <Stepper label="pengering" value={form.dryers_available} onChange={(v) => set("dryers_available", v)} />
              </Field>
            </div>
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
            <Field label="Catatan kendala mesin" hint="Mis. pengering 2 rusak.">
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
                Simpan
              </Button>
              <SavedNote show={saved} />
            </div>
          </form>
        </Card>

        <Card flush icon={IconList} tone="neutral" title="30 hari terakhir">
          {loadError ? (
            <div className="px-4 pb-5 sm:px-5">
              <ErrorText message={loadError} />
            </div>
          ) : !rows ? (
            <Loading rows={5} />
          ) : rows.length === 0 ? (
            <EmptyState icon={IconCalendar} title="Belum ada data harian">
              Tanpa data, perkiraan pakai kapasitas normal.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto px-3 pb-3 sm:px-4 sm:pb-4">
              <table className="w-full min-w-[560px] border-separate border-spacing-y-1.5 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-muted">
                    <th className="px-4 py-1.5 font-medium">Tanggal</th>
                    <th className="px-3 py-1.5 font-medium">Petugas</th>
                    <th className="px-3 py-1.5 font-medium">Cuci / Kering</th>
                    <th className="px-3 py-1.5 font-medium">Jam</th>
                    <th className="px-3 py-1.5 font-medium">Catatan</th>
                    <th className="px-4 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.date}
                      className={`[&>td]:py-3 [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl ${
                        form.date === r.date ? "[&>td]:bg-brand-50" : "[&>td]:bg-subtle hover:[&>td]:bg-tint"
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 font-medium text-ink">{formatDate(r.date)}</td>
                      <td className="tabular px-3">{r.staff_on_duty}</td>
                      <td className="tabular px-3">
                        {r.washers_available} / {r.dryers_available}
                      </td>
                      <td className="tabular whitespace-nowrap px-3">
                        {r.is_open ? (
                          `${r.open_time.slice(0, 5)}–${r.close_time.slice(0, 5)}`
                        ) : (
                          <span className="font-medium text-muted">Tutup</span>
                        )}
                      </td>
                      <td className="max-w-[240px] truncate px-3 text-muted">{r.machine_issue_note ?? "–"}</td>
                      <td className="px-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => edit(r)}>
                          Ubah
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
