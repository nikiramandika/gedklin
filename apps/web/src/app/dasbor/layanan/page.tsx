"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button, Card, ErrorText, Field, Loading, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { GROUP_LABEL, PROCESS_LABEL, priceRule } from "@/lib/format";
import type { AppSettings, CatalogGroup, CatalogItem, Role, ServicePromise } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const GROUPS: CatalogGroup[] = ["KILOAN", "SETRIKA", "KHUSUS", "SATUAN"];

export default function LayananPage() {
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<CatalogItem[]>("/catalog?include_inactive=true")
        .then(setCatalog)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell roles={ROLES}>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Layanan & Harga</h1>
      <p className="mb-4 text-sm text-slate-500">
        Harga awal diambil dari price list mitra. Perubahan di sini langsung dipakai kasir.
      </p>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <ErrorText message={error} />
          {!catalog ? (
            <Loading />
          ) : (
            GROUPS.map((g) => (
              <Card key={g} title={GROUP_LABEL[g]}>
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-slate-500">
                        <th className="px-4 py-2">Layanan</th>
                        <th className="px-4 py-2">Harga</th>
                        <th className="px-4 py-2">Tambahan</th>
                        <th className="px-4 py-2">Aktif</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {catalog
                        .filter((c) => c.group === g)
                        .map((c) => (
                          <CatalogRow key={c.code} item={c} onSaved={load} />
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))
          )}
        </div>
        <div className="space-y-6">
          <SettingsCard />
          <PromiseCard />
        </div>
      </div>
    </AppShell>
  );
}

function CatalogRow({ item, onSaved }: { item: CatalogItem; onSaved: () => void }) {
  const [form, setForm] = useState({
    price: String(item.price),
    extra: item.extra_price === null ? "" : String(item.extra_price),
    active: item.is_active,
  });
  const [status, setStatus] = useState<string | null>(null);
  const dirty =
    form.price !== String(item.price) ||
    form.extra !== (item.extra_price === null ? "" : String(item.extra_price)) ||
    form.active !== item.is_active;

  async function save() {
    setStatus(null);
    try {
      await api(`/catalog/${encodeURIComponent(item.code)}`, {
        method: "PUT",
        body: {
          price: Number(form.price),
          ...(item.extra_price !== null && { extra_price: Number(form.extra) }),
          is_active: form.active,
        },
      });
      onSaved();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="px-4 py-2">
        <p className={item.is_active ? "font-medium" : "font-medium text-slate-400"}>{item.name}</p>
        <p className="text-xs text-slate-500">
          {PROCESS_LABEL[item.process]} · {priceRule(item)}
        </p>
        {status && <p className="text-xs text-rose-600">{status}</p>}
      </td>
      <td className="px-4 py-2">
        <input
          className={`${inputClass} w-28`}
          type="number"
          min={0}
          step={500}
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          aria-label={`Harga ${item.name}`}
        />
      </td>
      <td className="px-4 py-2">
        {item.extra_price !== null && (
          <input
            className={`${inputClass} w-24`}
            type="number"
            min={0}
            step={500}
            value={form.extra}
            onChange={(e) => setForm({ ...form, extra: e.target.value })}
            aria-label={`Harga tambahan ${item.name}`}
          />
        )}
      </td>
      <td className="px-4 py-2">
        <input
          type="checkbox"
          className="mt-2 h-4 w-4 accent-teal-600"
          checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
          aria-label={`${item.name} aktif`}
        />
      </td>
      <td className="px-4 py-2 text-right">
        <Button variant="secondary" disabled={!dirty} onClick={save}>
          Simpan
        </Button>
      </td>
    </tr>
  );
}

function SettingsCard() {
  const [form, setForm] = useState<{ multiplier: string; promise: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AppSettings>("/settings")
      .then((s) =>
        setForm({
          multiplier: String(s.express_multiplier),
          promise: String(s.default_promise_hours),
        }),
      )
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!form) return <Card title="Express">{error ? <ErrorText message={error} /> : <Loading />}</Card>;

  return (
    <Card title="Express & janji default">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          setError(null);
          try {
            await api("/settings", {
              method: "PUT",
              body: {
                express_multiplier: Number(form.multiplier.replace(",", ".")),
                default_promise_hours: Number(form.promise),
              },
            });
            setMsg("Tersimpan");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          }
        }}
      >
        <Field label="Pengali harga Express (× harga Reguler)">
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.multiplier}
            onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
          />
        </Field>
        <Field label="Janji default bila layanan belum punya janji (jam)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={form.promise}
            onChange={(e) => setForm({ ...form, promise: e.target.value })}
          />
        </Field>
        <ErrorText message={error} />
        <div className="flex items-center gap-3">
          <Button type="submit">Simpan</Button>
          {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        </div>
      </form>
    </Card>
  );
}

function hoursValue(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

function PromiseCard() {
  const [rows, setRows] = useState<ServicePromise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<ServicePromise[]>("/service-promises")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  function update(i: number, patch: Partial<ServicePromise>) {
    setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <Card title="Janji waktu standar (jam)">
      <p className="mb-3 text-xs text-slate-500">
        Dipakai sebagai janji di nota dan fallback perkiraan bila model belum tersedia. Kosongkan
        bila belum diketahui. 1 hari = 24 jam.
      </p>
      {!rows ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setMsg(null);
            try {
              await Promise.all(
                rows.map((r) =>
                  api(`/service-promises/${r.process}`, {
                    method: "PUT",
                    body: {
                      regular_hours: r.regular_hours,
                      express_hours: r.express_hours,
                      min_regular_hours: r.min_regular_hours,
                    },
                  }),
                ),
              );
              setMsg("Tersimpan");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Gagal menyimpan");
            }
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1">Proses</th>
                <th className="py-1">Reguler</th>
                <th className="py-1">Express</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.process}>
                  <td className="py-1 pr-2 text-xs">{PROCESS_LABEL[r.process]}</td>
                  <td className="py-1 pr-2">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      placeholder="?"
                      value={r.regular_hours ?? ""}
                      onChange={(e) => update(i, { regular_hours: hoursValue(e.target.value) })}
                      aria-label={`Janji Reguler ${r.process}`}
                    />
                  </td>
                  <td className="py-1">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      placeholder="?"
                      value={r.express_hours ?? ""}
                      onChange={(e) => update(i, { express_hours: hoursValue(e.target.value) })}
                      aria-label={`Janji Express ${r.process}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ErrorText message={error} />
          <div className="mt-3 flex items-center gap-3">
            <Button type="submit">Simpan</Button>
            {msg && <span className="text-sm text-emerald-700">{msg}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
