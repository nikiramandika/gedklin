"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  SavedNote,
  inputClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { IconBolt, IconClock } from "@/components/icons";
import { api } from "@/lib/api";
import { GROUP_LABEL, PROCESS_LABEL, priceRule } from "@/lib/format";
import type { AppSettings, CatalogGroup, CatalogItem, Role, ServicePromise } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const GROUPS: CatalogGroup[] = ["KILOAN", "SETRIKA", "KHUSUS", "SATUAN"];

export default function LayananPage() {
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [group, setGroup] = useState<CatalogGroup>("KILOAN");
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

  const items = catalog?.filter((c) => c.group === group) ?? null;

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Layanan & Harga"
        description="Harga awal diambil dari price list mitra. Perubahan langsung dipakai kasir untuk pesanan berikutnya."
      />
      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card flush>
          <div
            role="tablist"
            aria-label="Kelompok layanan"
            className="m-3 flex gap-1 overflow-x-auto rounded-xl bg-canvas p-1 sm:m-4"
          >
            {GROUPS.map((g) => {
              const active = g === group;
              const n = catalog?.filter((c) => c.group === g).length;
              return (
                <button
                  key={g}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setGroup(g)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                    active ? "bg-surface text-brand-700 shadow-tile" : "text-muted hover:bg-surface/70 hover:text-ink"
                  }`}
                >
                  {GROUP_LABEL[g]}
                  {n !== undefined && <span className="tabular text-xs opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          {error && (
            <div className="p-4">
              <ErrorText message={error} />
            </div>
          )}
          {!items ? (
            <Loading rows={5} />
          ) : (
            <>
            <div
              aria-hidden="true"
              className="hidden px-7 pb-1 sm:px-8 text-xs font-medium text-muted md:grid md:grid-cols-[minmax(0,1fr)_140px_140px_190px] md:gap-4"
            >
              <span>Layanan</span>
              <span>Harga</span>
              <span>Tambahan</span>
              <span />
            </div>
            <ul className={tileListClass}>
              {items.map((c) => (
                <CatalogRow key={c.code} item={c} onSaved={load} />
              ))}
            </ul>
            </>
          )}
        </Card>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 2xl:grid-cols-1">
          <SettingsCard />
          <PromiseCard />
        </div>
      </div>
    </AppShell>
  );
}

function MoneyInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">Rp</span>
      <input
        className={`${inputClass} tabular pl-9`}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        aria-label={label}
      />
    </div>
  );
}

function CatalogRow({ item, onSaved }: { item: CatalogItem; onSaved: () => void }) {
  const [form, setForm] = useState({
    price: String(item.price),
    extra: item.extra_price === null ? "" : String(item.extra_price),
    active: item.is_active,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty =
    form.price !== String(item.price) ||
    form.extra !== (item.extra_price === null ? "" : String(item.extra_price)) ||
    form.active !== item.is_active;

  async function save() {
    setStatus(null);
    setBusy(true);
    try {
      await api(`/catalog/${encodeURIComponent(item.code)}`, {
        method: "PUT",
        body: {
          price: Number(form.price),
          ...(item.extra_price !== null && { extra_price: Number(form.extra) }),
          is_active: form.active,
        },
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  const update = (patch: Partial<typeof form>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  return (
    <li className={`${tileClass} grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_140px_140px_190px] md:items-center md:gap-4`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-medium ${form.active ? "text-ink" : "text-faint line-through"}`}>{item.name}</p>
          {!item.is_active && (
            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line">
              Nonaktif
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[13px] text-muted">
          {priceRule(item)}
        </p>
        {status && <p className="mt-1 text-[13px] text-danger-600">{status}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:contents">
        <Field label="Harga" className="md:[&>span:first-child]:sr-only">
          <MoneyInput label={`Harga ${item.name}`} value={form.price} onChange={(v) => update({ price: v })} />
        </Field>
        {item.extra_price !== null ? (
          <Field label="Tambahan" className="md:[&>span:first-child]:sr-only">
            <MoneyInput
              label={`Harga tambahan ${item.name}`}
              value={form.extra}
              onChange={(v) => update({ extra: v })}
            />
          </Field>
        ) : (
          <span className="hidden text-center text-sm text-faint md:block">–</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 md:justify-end">
        <label className="flex h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="h-5 w-5 rounded accent-brand-600"
            checked={form.active}
            onChange={(e) => update({ active: e.target.checked })}
          />
          Aktif
        </label>
        {saved && !dirty ? (
          <span className="w-24 text-right">
            <SavedNote show />
          </span>
        ) : (
          <Button variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={busy} onClick={save} className="w-24">
            Simpan
          </Button>
        )}
      </div>
    </li>
  );
}

function SettingsCard() {
  const [form, setForm] = useState<{ multiplier: string; promise: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
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

  if (!form)
    return (
      <Card title="Express & janji default">{error ? <ErrorText message={error} /> : <Loading rows={2} />}</Card>
    );

  return (
    <Card icon={IconBolt} tone="warn" title="Express & janji default">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(false);
          setError(null);
          setBusy(true);
          try {
            await api("/settings", {
              method: "PUT",
              body: {
                express_multiplier: Number(form.multiplier.replace(",", ".")),
                default_promise_hours: Number(form.promise),
              },
            });
            setSaved(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Pengali harga Express" hint="Harga Express = harga Reguler × pengali ini.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">×</span>
            <input
              className={`${inputClass} tabular pl-8`}
              inputMode="decimal"
              value={form.multiplier}
              onChange={(e) => {
                setSaved(false);
                setForm({ ...form, multiplier: e.target.value });
              }}
            />
          </div>
        </Field>
        <Field label="Janji default (jam)" hint="Dipakai bila layanan belum punya janji waktu sendiri.">
          <input
            className={`${inputClass} tabular`}
            type="number"
            min={1}
            value={form.promise}
            onChange={(e) => {
              setSaved(false);
              setForm({ ...form, promise: e.target.value });
            }}
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
  );
}

function hoursValue(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

function PromiseCard() {
  const [rows, setRows] = useState<ServicePromise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ServicePromise[]>("/service-promises")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  function update(i: number, patch: Partial<ServicePromise>) {
    setSaved(false);
    setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <Card
      icon={IconClock}
      tone="neutral"
      title="Janji waktu standar"
      description="Dalam jam (1 hari = 24 jam). Kosongkan bila belum diketahui."
    >
      <p className="mb-4 text-[13px] text-muted">
        Dipakai sebagai janji di nota dan cadangan perkiraan bila model belum tersedia.
      </p>
      {!rows ? (
        error ? <ErrorText message={error} /> : <Loading rows={4} />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setSaved(false);
            setBusy(true);
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
              setSaved(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Gagal menyimpan");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_84px_84px] gap-2 text-xs font-medium text-muted">
            <span>Proses</span>
            <span>Reguler</span>
            <span>Express</span>
          </div>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.process} className="grid grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-2">
                <span className="text-[13px] text-ink-2">{PROCESS_LABEL[r.process]}</span>
                <input
                  className={`${inputClass} tabular px-2.5 text-center`}
                  type="number"
                  min={1}
                  placeholder="?"
                  value={r.regular_hours ?? ""}
                  onChange={(e) => update(i, { regular_hours: hoursValue(e.target.value) })}
                  aria-label={`Janji Reguler ${PROCESS_LABEL[r.process]} (jam)`}
                />
                <input
                  className={`${inputClass} tabular px-2.5 text-center`}
                  type="number"
                  min={1}
                  placeholder="?"
                  value={r.express_hours ?? ""}
                  onChange={(e) => update(i, { express_hours: hoursValue(e.target.value) })}
                  aria-label={`Janji Express ${PROCESS_LABEL[r.process]} (jam)`}
                />
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-3">
            <ErrorText message={error} />
            <div className="flex items-center gap-4">
              <Button type="submit" loading={busy}>
                Simpan janji
              </Button>
              <SavedNote show={saved} />
            </div>
          </div>
        </form>
      )}
    </Card>
  );
}
