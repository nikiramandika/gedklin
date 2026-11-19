"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconBolt, IconClock, IconPlus, IconTag, IconTrash } from "@/components/icons";
import { ConfirmDialog, Drawer, useToast } from "@/components/overlay";
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
  Segmented,
  Select,
  Switch,
  inputClass,
  tabClass,
  tabListClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { GROUP_RULES, PRICE_LABEL, UNIT_LABEL, codeFromName } from "@/lib/catalog";
import { GROUP_LABEL, PROCESS_LABEL, formatRupiah, priceRule } from "@/lib/format";
import type {
  AppSettings,
  CatalogGroup,
  CatalogItem,
  CatalogUnit,
  Process,
  Role,
  ServicePromise,
} from "@/lib/types";

const ROLES: Role[] = ["owner"];
const GROUPS: CatalogGroup[] = ["KILOAN", "SETRIKA", "KHUSUS", "SATUAN", "DRY_CLEAN"];

type Editor = { item?: CatalogItem } | null;
type Pending = { action: "delete" | "toggle"; item: CatalogItem } | null;

export default function LayananPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [group, setGroup] = useState<CatalogGroup>("KILOAN");
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

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

  function ask(action: "delete" | "toggle", item: CatalogItem) {
    setPendingError(null);
    setPending({ action, item });
  }

  async function confirmPending() {
    if (!pending) return;
    const { action, item } = pending;
    const path = `/catalog/${encodeURIComponent(item.code)}`;
    setPendingBusy(true);
    setPendingError(null);
    try {
      if (action === "delete") {
        await api(path, { method: "DELETE" });
        toast(`${item.name} dihapus`);
      } else {
        await api(path, { method: "PUT", body: { is_active: !item.is_active } });
        toast(`${item.name} ${item.is_active ? "dinonaktifkan" : "diaktifkan"}`);
      }
      setPending(null);
      await load();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setPendingBusy(false);
    }
  }

  const items = catalog?.filter((c) => c.group === group) ?? null;

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Layanan & Harga"
        description="Perubahan langsung dipakai kasir."
        actions={
          <Button onClick={() => setEditor({})}>
            <IconPlus size={18} />
            Tambah layanan
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card flush>
          <div
            role="tablist"
            aria-label="Kelompok layanan"
            className={tabListClass}
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
                  className={tabClass(active)}
                >
                  {GROUP_LABEL[g]}
                  {n !== undefined && <span className="tabular text-sm font-medium text-faint">{n}</span>}
                </button>
              );
            })}
          </div>
          {error && (
            <div className="px-4 pb-3 sm:px-5">
              <ErrorText message={error} />
            </div>
          )}
          {!items ? (
            !error && <Loading rows={5} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={IconTag}
              title={`Belum ada layanan ${GROUP_LABEL[group].toLowerCase()}`}
              action={
                <Button variant="secondary" onClick={() => setEditor({})}>
                  <IconPlus size={18} />
                  Tambah layanan
                </Button>
              }
            />
          ) : (
            <ul className={tileListClass}>
              {items.map((c) => (
                <CatalogRow
                  key={c.code}
                  item={c}
                  onEdit={() => setEditor({ item: c })}
                  onToggle={() => ask("toggle", c)}
                  onDelete={() => ask("delete", c)}
                />
              ))}
            </ul>
          )}
        </Card>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 2xl:grid-cols-1">
          <SettingsCard />
          <PromiseCard />
        </div>
      </div>

      <ServiceDrawer
        editor={editor}
        defaultGroup={group}
        onClose={() => setEditor(null)}
        onSaved={(saved, created) => {
          setEditor(null);
          setGroup(saved.group);
          toast(created ? `${saved.name} ditambahkan` : "Perubahan disimpan");
          load();
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
        busy={pendingBusy}
        error={pendingError}
        {...confirmCopy(pending)}
      />
    </AppShell>
  );
}

function confirmCopy(pending: Pending) {
  const name = pending?.item.name ?? "layanan";
  if (pending?.action === "delete")
    return {
      tone: "danger" as const,
      title: `Hapus ${name}?`,
      confirmLabel: "Hapus",
      children:
        "Layanan hilang dari daftar kasir dan tidak bisa dikembalikan. Layanan yang sudah pernah dipesan tidak bisa dihapus, cukup dinonaktifkan.",
    };
  if (pending?.item.is_active)
    return {
      tone: "warn" as const,
      title: `Nonaktifkan ${name}?`,
      confirmLabel: "Nonaktifkan",
      children:
        "Kasir tidak bisa memilih layanan ini untuk pesanan baru. Pesanan dan nota yang sudah ada tidak berubah, dan layanan bisa diaktifkan lagi kapan saja.",
    };
  return {
    tone: "brand" as const,
    title: `Aktifkan ${name}?`,
    confirmLabel: "Aktifkan",
    children: "Layanan akan langsung muncul di daftar kasir dengan harga yang tercantum.",
  };
}

function CatalogRow({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: CatalogItem;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const noPrice = item.price === null;

  return (
    <li className={`${tileClass} flex flex-wrap items-center gap-x-4 gap-y-3 p-4`}>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 rounded-lg text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-base font-semibold ${item.is_active ? "text-ink" : "text-faint"}`}>{item.name}</span>
          {item.express_eligible && <ExpressBadge />}
          {!item.is_active && (
            <span className="label-caps rounded-md bg-subtle px-2 py-1 leading-none ring-1 ring-inset ring-line text-faint">
              {noPrice ? "Belum ada harga" : "Nonaktif"}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-sm text-muted">
          <span className="font-mono font-semibold text-ink-2">{item.code}</span>
          {PROCESS_LABEL[item.process] !== item.name && ` · ${PROCESS_LABEL[item.process]}`} · {priceRule(item)}
        </span>
      </button>
      <p className="tabular text-right text-base font-semibold text-ink">
        {noPrice ? "–" : formatRupiah(item.price ?? 0)}
      </p>
      <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
        <Button
          variant="ghost"
          size="sm"
          disabled={!item.is_active && noPrice}
          title={!item.is_active && noPrice ? "Isi harga dulu lewat Ubah" : undefined}
          onClick={onToggle}
        >
          {item.is_active ? "Nonaktifkan" : "Aktifkan"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Ubah
        </Button>
        <IconButton
          label={`Hapus ${item.name}`}
          icon={IconTrash}
          size={18}
          className="hover:bg-danger-50 hover:text-danger-600"
          onClick={onDelete}
        />
      </div>
    </li>
  );
}

type LoadMode = "pcs" | "kg";

interface FormState {
  code: string;
  name: string;
  group: CatalogGroup;
  process: Process;
  unit: CatalogUnit;
  price: string;
  extra: string;
  baseKg: string;
  minQty: string;
  loadMode: LoadMode;
  perLoad: string;
  maxExtra: string;
  express: boolean;
  active: boolean;
}

const FORM_ID = "service-form";
const str = (v: number | null) => (v === null ? "" : String(v));

function toNumber(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

function initialForm(item: CatalogItem | undefined, group: CatalogGroup): FormState {
  if (item) {
    return {
      code: item.code,
      name: item.name,
      group: item.group,
      process: item.process,
      unit: item.unit,
      price: str(item.price),
      extra: str(item.extra_price),
      baseKg: str(item.base_kg),
      minQty: str(item.min_qty),
      loadMode: item.kg_per_load ? "kg" : "pcs",
      perLoad: str(item.kg_per_load ?? item.pcs_per_load),
      maxExtra: str(item.max_extra),
      express: item.express_eligible,
      active: item.is_active,
    };
  }
  const rules = GROUP_RULES[group];
  return {
    code: "",
    name: "",
    group,
    process: rules.processes[0],
    unit: rules.units[0],
    price: "",
    extra: "",
    baseKg: "7",
    minQty: "",
    loadMode: "pcs",
    perLoad: "",
    maxExtra: "",
    express: false,
    active: true,
  };
}

function ServiceDrawer({
  editor,
  defaultGroup,
  onClose,
  onSaved,
}: {
  editor: Editor;
  defaultGroup: CatalogGroup;
  onClose: () => void;
  onSaved: (item: CatalogItem, created: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const item = editor?.item;
  // Kunci ulang form setiap kali drawer dibuka untuk item yang berbeda.
  const formKey = editor ? (item?.code ?? `new-${defaultGroup}`) : "closed";

  return (
    <Drawer
      open={editor !== null}
      onClose={onClose}
      title={item ? `Ubah ${item.name}` : "Tambah layanan"}
      description={
        item
          ? "Perubahan harga berlaku untuk pesanan berikutnya. Nota lama tidak berubah."
          : "Isi sesuai price list mitra. Harga boleh dikosongkan bila belum diketahui."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy}>
            {item ? "Simpan perubahan" : "Tambah layanan"}
          </Button>
        </>
      }
    >
      {editor && (
        <ServiceForm
          key={formKey}
          item={item}
          defaultGroup={defaultGroup}
          onBusy={setBusy}
          onSaved={onSaved}
        />
      )}
    </Drawer>
  );
}

function ServiceForm({
  item,
  defaultGroup,
  onBusy,
  onSaved,
}: {
  item?: CatalogItem;
  defaultGroup: CatalogGroup;
  onBusy: (busy: boolean) => void;
  onSaved: (item: CatalogItem, created: boolean) => void;
}) {
  const editing = item !== undefined;
  const [form, setForm] = useState<FormState>(() => initialForm(item, defaultGroup));
  const [codeTouched, setCodeTouched] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const rules = GROUP_RULES[form.group];
  const noPrice = form.price.trim() === "";

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function changeGroup(group: CatalogGroup) {
    const r = GROUP_RULES[group];
    set({
      group,
      process: r.processes.includes(form.process) ? form.process : r.processes[0],
      unit: r.units.includes(form.unit) ? form.unit : r.units[0],
      express: group === "KILOAN" && form.express,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    onBusy(true);
    const perLoad = form.unit === "LOAD" ? toNumber(form.perLoad) : null;
    const body = {
      name: form.name.trim(),
      group: form.group,
      process: form.process,
      unit: form.unit,
      price: toNumber(form.price),
      extra_price: ["KILOAN_7KG", "LOAD"].includes(form.unit) ? toNumber(form.extra) : null,
      base_kg: form.unit === "KILOAN_7KG" ? toNumber(form.baseKg) : null,
      min_qty: ["KG", "LOAD"].includes(form.unit) ? toNumber(form.minQty) : null,
      kg_per_load: form.loadMode === "kg" ? perLoad : null,
      pcs_per_load: form.loadMode === "pcs" ? perLoad : null,
      max_extra: form.unit === "LOAD" ? toNumber(form.maxExtra) : null,
      express_eligible: form.unit === "KILOAN_7KG" && form.express,
      is_active: form.active && !noPrice,
    };
    try {
      const saved = editing
        ? await api<CatalogItem>(`/catalog/${encodeURIComponent(form.code)}`, { method: "PUT", body })
        : await api<CatalogItem>("/catalog", { method: "POST", body: { ...body, code: form.code } });
      onSaved(saved, !editing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      onBusy(false);
    }
  }

  const money = (value: string, onChange: (v: string) => void, label: string) => (
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

  const decimal = (value: string, onChange: (v: string) => void, required = false) => (
    <input
      className={`${inputClass} tabular`}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    />
  );

  return (
    <form id={FORM_ID} onSubmit={submit} className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Identitas</h3>
        <Field label="Nama layanan">
          <input
            className={inputClass}
            value={form.name}
            autoFocus={!editing}
            required
            maxLength={100}
            onChange={(e) =>
              set({ name: e.target.value, ...(!codeTouched && { code: codeFromName(e.target.value) }) })
            }
          />
        </Field>
        <Field
          label="Kode"
          hint={editing ? "Tidak bisa diubah (dipakai di nota lama)." : "Huruf besar, angka, garis bawah."}
        >
          <input
            className={`${inputClass} font-mono uppercase`}
            value={form.code}
            disabled={editing}
            required
            maxLength={40}
            pattern="[A-Z0-9_]+"
            onChange={(e) => {
              setCodeTouched(true);
              set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") });
            }}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kelompok">
            <Select value={form.group} onChange={(e) => changeGroup(e.target.value as CatalogGroup)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Proses">
            <Select
              value={form.process}
              disabled={rules.processes.length === 1}
              onChange={(e) => set({ process: e.target.value as Process })}
            >
              {rules.processes.map((p) => (
                <option key={p} value={p}>
                  {PROCESS_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-dashed border-field/60 p-4">
        <h3 className="text-sm font-semibold text-ink">Harga</h3>
        <Field label="Satuan harga">
          <Select
            value={form.unit}
            disabled={rules.units.length === 1}
            onChange={(e) => set({ unit: e.target.value as CatalogUnit })}
          >
            {rules.units.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={PRICE_LABEL[form.unit]} hint="Kosongkan bila belum diketahui.">
            {money(form.price, (price) => set({ price }), PRICE_LABEL[form.unit])}
          </Field>
          {form.unit === "KILOAN_7KG" && (
            <>
              <Field label="Berat dasar (kg)" hint="Sudah termasuk harga dasar.">
                {decimal(form.baseKg, (baseKg) => set({ baseKg }), true)}
              </Field>
              <Field label="Tambahan per kg" hint="Setiap kg di atas berat dasar." className="sm:col-span-2">
                {money(form.extra, (extra) => set({ extra }), "Tambahan per kg")}
              </Field>
            </>
          )}
          {(form.unit === "KG" || form.unit === "LOAD") && (
            <Field
              label={form.unit === "KG" ? "Minimal (kg)" : "Minimal (pcs atau kg)"}
              hint="Kosongkan bila tanpa minimal."
            >
              {decimal(form.minQty, (minQty) => set({ minQty }))}
            </Field>
          )}
        </div>
        {form.unit === "LOAD" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kapasitas satu load" className="sm:col-span-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <Segmented<LoadMode>
                  label="Satuan kapasitas"
                  value={form.loadMode}
                  onChange={(loadMode) => set({ loadMode })}
                  options={[
                    { value: "pcs", label: "Per pcs" },
                    { value: "kg", label: "Per kg" },
                  ]}
                />
                {decimal(form.perLoad, (perLoad) => set({ perLoad }), true)}
              </div>
            </Field>
            <Field label="Tambahan per pcs">
              {money(form.extra, (extra) => set({ extra }), "Tambahan per pcs")}
            </Field>
            <Field label="Maks tambahan per load (pcs)">
              {decimal(form.maxExtra, (maxExtra) => set({ maxExtra }))}
            </Field>
          </div>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="mb-2 text-sm font-semibold text-ink">Ketersediaan</h3>
        {form.unit === "KILOAN_7KG" && (
          <Switch
            label="Bisa Express"
            description="Harga = Reguler × pengali."
            checked={form.express}
            onChange={(express) => set({ express })}
          />
        )}
        <Switch
          label="Aktif"
          description={noPrice ? "Isi harga dulu." : "Tampil di kasir."}
          checked={form.active && !noPrice}
          onChange={(active) => set({ active })}
        />
      </section>

      <ErrorText message={error} />
    </form>
  );
}

function SettingsCard() {
  const toast = useToast();
  const [form, setForm] = useState<{ multiplier: string; capacity: string; promise: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AppSettings>("/settings")
      .then((s) =>
        setForm({
          multiplier: String(s.express_multiplier),
          capacity: String(s.machine_capacity_kg),
          promise: String(s.default_promise_hours),
        }),
      )
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!form)
    return (
      <Card title="Express, mesin & janji default">{error ? <ErrorText message={error} /> : <Loading rows={2} />}</Card>
    );

  return (
    <Card icon={IconBolt} tone="warn" title="Express, mesin & janji default">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            await api("/settings", {
              method: "PUT",
              body: {
                express_multiplier: Number(form.multiplier.replace(",", ".")),
                machine_capacity_kg: Number(form.capacity.replace(",", ".")),
                default_promise_hours: Number(form.promise),
              },
            });
            toast("Pengaturan disimpan");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Pengali harga Express"
          hint="Harga Express = Reguler × pengali."
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">×</span>
            <input
              className={`${inputClass} tabular pl-8`}
              inputMode="decimal"
              value={form.multiplier}
              onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
            />
          </div>
        </Field>
        <Field
          label="Kapasitas mesin cuci (kg)"
          hint="Untuk perkiraan waktu, bukan harga."
        >
          <input
            className={`${inputClass} tabular`}
            inputMode="decimal"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
        </Field>
        <Field label="Janji default (jam)" hint="Bila layanan belum punya janji sendiri.">
          <input
            className={`${inputClass} tabular`}
            type="number"
            min={1}
            value={form.promise}
            onChange={(e) => setForm({ ...form, promise: e.target.value })}
          />
        </Field>
        <ErrorText message={error} />
        <Button type="submit" loading={busy}>
          Simpan pengaturan
        </Button>
      </form>
    </Card>
  );
}

function hoursValue(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

function PromiseCard() {
  const toast = useToast();
  const [rows, setRows] = useState<ServicePromise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ServicePromise[]>("/service-promises")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  function update(i: number, patch: Partial<ServicePromise>) {
    setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <Card
      icon={IconClock}
      tone="neutral"
      title="Janji waktu standar"
      description="Dalam jam. Kosongkan bila belum tahu."
    >
      <p className="mb-4 text-xs text-muted">
        Janji di nota dan cadangan bila model belum ada.
      </p>
      {!rows ? (
        error ? <ErrorText message={error} /> : <Loading rows={4} />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
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
              toast("Janji waktu disimpan");
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
                <span className="text-xs text-ink-2">{PROCESS_LABEL[r.process]}</span>
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
            <Button type="submit" loading={busy}>
              Simpan janji
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
