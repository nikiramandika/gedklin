"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button, Card, ErrorText, Field, Loading, inputClass } from "@/components/ui";
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
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<DailyOperation[]>("/daily-operations?days=30")
        .then(setRows)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
    // Isi awal form dari kapasitas normal mitra di pengaturan.
    api<AppSettings>("/settings")
      .then((s) =>
        setForm((f) => ({
          ...f,
          staff_on_duty: String(s.default_staff_on_duty),
          washers_available: String(s.default_washers_available),
          dryers_available: String(s.default_dryers_available),
          open_time: s.default_open_time.slice(0, 5),
          close_time: s.default_close_time.slice(0, 5),
        })),
      )
      .catch(() => {});
  }, [load]);

  function edit(row: DailyOperation) {
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
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Operasional Harian</h1>
      <p className="mb-4 text-sm text-slate-500">
        Petugas, mesin yang bisa dipakai, dan jam buka dipakai sebagai fitur perkiraan waktu siap.
        Isi setiap hari, terutama saat ada mesin rusak atau petugas izin.
      </p>
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card title="Isi / ubah data">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setMsg(null);
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
                setMsg("Tersimpan");
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Gagal menyimpan");
              }
            }}
          >
            <Field label="Tanggal">
              <input
                className={inputClass}
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-teal-600"
                checked={form.is_open}
                onChange={(e) => setForm({ ...form, is_open: e.target.checked })}
              />
              Buka pada tanggal ini
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Petugas">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  value={form.staff_on_duty}
                  onChange={(e) => setForm({ ...form, staff_on_duty: e.target.value })}
                  required
                />
              </Field>
              <Field label="Mesin cuci">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  value={form.washers_available}
                  onChange={(e) => setForm({ ...form, washers_available: e.target.value })}
                  required
                />
              </Field>
              <Field label="Pengering">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  value={form.dryers_available}
                  onChange={(e) => setForm({ ...form, dryers_available: e.target.value })}
                  required
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Jam buka">
                <input
                  className={inputClass}
                  type="time"
                  value={form.open_time}
                  onChange={(e) => setForm({ ...form, open_time: e.target.value })}
                  required
                />
              </Field>
              <Field label="Jam tutup">
                <input
                  className={inputClass}
                  type="time"
                  value={form.close_time}
                  onChange={(e) => setForm({ ...form, close_time: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Catatan kendala mesin (opsional)">
              <textarea
                className={inputClass}
                rows={2}
                value={form.machine_issue_note}
                onChange={(e) => setForm({ ...form, machine_issue_note: e.target.value })}
              />
            </Field>
            <ErrorText message={error} />
            <div className="flex items-center gap-3">
              <Button type="submit">Simpan</Button>
              {msg && <span className="text-sm text-emerald-700">{msg}</span>}
            </div>
          </form>
        </Card>

        <Card title="30 hari terakhir">
          {!rows ? (
            <Loading />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Belum ada data.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Tanggal</th>
                  <th className="py-2">Petugas</th>
                  <th className="py-2">Cuci/Kering</th>
                  <th className="py-2">Jam</th>
                  <th className="py-2">Catatan</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">{formatDate(r.date)}</td>
                    <td className="py-2">{r.staff_on_duty}</td>
                    <td className="py-2">
                      {r.washers_available}/{r.dryers_available}
                    </td>
                    <td className="py-2">
                      {r.is_open
                        ? `${r.open_time.slice(0, 5)}–${r.close_time.slice(0, 5)}`
                        : "Tutup"}
                    </td>
                    <td className="py-2 text-slate-600">{r.machine_issue_note ?? "-"}</td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" onClick={() => edit(r)}>
                        Ubah
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
