"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { IconChevronRight, IconPlus, IconTag, IconTrash } from "@/components/icons";
import { ConfirmDialog, Drawer, useToast } from "@/components/overlay";
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  ExpressBadge,
  Field,
  Loading,
  PageHeader,
  Segmented,
  Select,
  Switch,
  buttonClass,
  inputClass,
  tabClass,
  tabListClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  GROUP_RULES,
  PRICE_LABEL,
  UNIT_LABEL,
  WORK_UNIT,
  autoWorkTime,
  codeFromName,
  needsWorkTime,
} from "@/lib/catalog";
import { GROUP_LABEL, PROCESS_LABEL, formatRupiah } from "@/lib/format";
import type { CatalogGroup, CatalogItem, CatalogUnit, Process, Role } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const GROUPS: CatalogGroup[] = ["KILOAN", "SETRIKA", "KHUSUS", "SATUAN", "DRY_CLEAN"];

type Editor = { item?: CatalogItem } | null;

export default function LayananPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [group, setGroup] = useState<CatalogGroup>("KILOAN");
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(`/catalog/${encodeURIComponent(deleting.code)}`, { method: "DELETE" });
      toast(`${deleting.name} dihapus`);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setDeleteBusy(false);
    }
  }

  const items = catalog?.filter((c) => c.group === group) ?? null;

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Layanan & Harga"
        description="Perubahan langsung dipakai di kasir."
        actions={
          <>
            <Link href="/pengaturan#harga" className={buttonClass("secondary")}>
              Pengaturan Express
            </Link>
            <Button onClick={() => setEditor({})}>
              <IconPlus size={18} />
              Tambah layanan
            </Button>
          </>
        }
      />
      <Card flush>
        <div role="tablist" aria-label="Kelompok layanan" className={tabListClass}>
          {GROUPS.map((g) => {
            const active = g === group;
            const n = catalog?.filter((c) => c.group === g).length;
            return (
              <button key={g} role="tab" aria-selected={active} onClick={() => setGroup(g)} className={tabClass(active)}>
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
              <CatalogRow key={c.code} item={c} onEdit={() => setEditor({ item: c })} />
            ))}
          </ul>
        )}
      </Card>

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
        onDelete={(item) => {
          setEditor(null);
          setDeleteError(null);
          setDeleting(item);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        busy={deleteBusy}
        error={deleteError}
        tone="danger"
        title={`Hapus ${deleting?.name ?? "layanan"}?`}
        confirmLabel="Hapus"
      >
        Layanan hilang dari kasir dan tidak bisa dikembalikan. Yang sudah pernah dipesan tidak bisa dihapus, cukup
        matikan &quot;Tampil di kasir&quot;.
      </ConfirmDialog>
    </AppShell>
  );
}

/* ---------- Daftar ---------- */

// Harga di kanan baris, dengan satuannya di bawah.
const PRICE_UNIT: Record<CatalogUnit, (item: CatalogItem) => string> = {
  KILOAN_7KG: (i) => `${i.base_kg ?? 7} kg pertama`,
  KG: () => "per kg",
  PCS: () => "per pcs",
  LOAD: (i) => `per load ${i.kg_per_load ? `${i.kg_per_load} kg` : `${i.pcs_per_load} pcs`}`,
};

// Hari kalau pas kelipatan 24 jam, karena mitra menyebut janji dalam hari.
function promiseText(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24} hari` : `${hours} jam`;
}

function workText(minutes: number, unit: CatalogUnit): string {
  return `${minutes.toLocaleString("id-ID", { maximumFractionDigits: 1 })} mnt/${WORK_UNIT[unit]}`;
}

// Satu baris keterangan singkat: aturan harga tambahan, lama kerja, janji.
function rowMeta(item: CatalogItem): string {
  const parts: string[] = [];
  if (PROCESS_LABEL[item.process] !== item.name) parts.push(PROCESS_LABEL[item.process]);
  if (item.extra_price) parts.push(`+${formatRupiah(item.extra_price)}/${item.unit === "LOAD" ? "pcs" : "kg"}`);
  if (item.min_qty) parts.push(`min. ${item.min_qty} ${item.unit === "KG" ? "kg" : ""}`.trim());
  if (item.work_minutes !== null) parts.push(workText(item.work_minutes, item.unit));
  if (item.promise_hours !== null) parts.push(`siap ${promiseText(item.promise_hours)}`);
  return parts.join(" · ");
}

function CatalogRow({ item, onEdit }: { item: CatalogItem; onEdit: () => void }) {
  const noPrice = item.price === null;
  const meta = rowMeta(item);

  return (
    <li className={tileClass}>
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-4 rounded-xl p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`text-base font-semibold ${item.is_active ? "text-ink" : "text-faint"}`}>{item.name}</span>
            {item.express_eligible && <ExpressBadge />}
            {!item.is_active && <Tag>{noPrice ? "Belum ada harga" : "Tidak tampil"}</Tag>}
            {needsWorkTime(item) && <Tag tone="warn">Lama kerja kosong</Tag>}
          </span>
          {meta && <span className="tabular mt-0.5 block text-sm text-muted">{meta}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-base font-semibold text-ink">
            {noPrice ? "–" : formatRupiah(item.price ?? 0)}
          </span>
          <span className="block text-xs text-muted">{PRICE_UNIT[item.unit](item)}</span>
        </span>
        <IconChevronRight size={18} className="shrink-0 text-faint" aria-hidden="true" />
      </button>
    </li>
  );
}

function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  const style =
    tone === "warn" ? "bg-warn-50 text-warn-700 ring-warn-600/25" : "bg-subtle text-muted ring-line";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium leading-none ring-1 ring-inset ${style}`}
    >
      {children}
    </span>
  );
}

/* ---------- Form ---------- */

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
  workMinutes: string;
  promise: string;
  expressPromise: string;
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
      workMinutes: str(item.work_minutes),
      promise: str(item.promise_hours),
      expressPromise: str(item.express_promise_hours),
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
    workMinutes: "",
    promise: "",
    expressPromise: "",
    express: false,
    active: true,
  };
}

function ServiceDrawer({
  editor,
  defaultGroup,
  onClose,
  onSaved,
  onDelete,
}: {
  editor: Editor;
  defaultGroup: CatalogGroup;
  onClose: () => void;
  onSaved: (item: CatalogItem, created: boolean) => void;
  onDelete: (item: CatalogItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const item = editor?.item;
  // Kunci ulang form setiap kali drawer dibuka untuk item yang berbeda.
  const formKey = editor ? (item?.code ?? `new-${defaultGroup}`) : "closed";

  return (
    <Drawer
      open={editor !== null}
      onClose={onClose}
      title={item ? item.name : "Tambah layanan"}
      description={item ? "Perubahan berlaku untuk pesanan berikutnya." : undefined}
      footer={
        <>
          {item && (
            <Button
              variant="ghost"
              className="mr-auto text-danger-700 hover:bg-danger-50"
              onClick={() => onDelete(item)}
              disabled={busy}
            >
              <IconTrash size={16} />
              Hapus
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy}>
            {item ? "Simpan" : "Tambah layanan"}
          </Button>
        </>
      }
    >
      {editor && (
        <ServiceForm key={formKey} item={item} defaultGroup={defaultGroup} onBusy={setBusy} onSaved={onSaved} />
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Suffixed({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{suffix}</span>
    </div>
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
  const kiloan = form.unit === "KILOAN_7KG";

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
      base_kg: kiloan ? toNumber(form.baseKg) : null,
      min_qty: ["KG", "LOAD"].includes(form.unit) ? toNumber(form.minQty) : null,
      kg_per_load: form.loadMode === "kg" ? perLoad : null,
      pcs_per_load: form.loadMode === "pcs" ? perLoad : null,
      max_extra: form.unit === "LOAD" ? toNumber(form.maxExtra) : null,
      work_minutes: toNumber(form.workMinutes),
      promise_hours: toNumber(form.promise),
      express_promise_hours: kiloan && form.express ? toNumber(form.expressPromise) : null,
      express_eligible: kiloan && form.express,
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

  const money = (value: string, onChange: (v: string) => void, label: string, placeholder?: string) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">Rp</span>
      <input
        className={`${inputClass} tabular pl-9`}
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        aria-label={label}
      />
    </div>
  );

  const decimal = (value: string, onChange: (v: string) => void, required = false, placeholder?: string) => (
    <input
      className={`${inputClass} tabular`}
      inputMode="decimal"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    />
  );

  const hours = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <Suffixed suffix="jam">
      <input
        className={`${inputClass} tabular pr-12`}
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </Suffixed>
  );

  // Hint janji: tampilkan dalam hari begitu angkanya pas, supaya mudah dicek.
  const daysHint = (value: string, empty: string) => {
    const n = toNumber(value);
    if (n === null) return empty;
    return n > 0 && n % 24 === 0 ? `= ${n / 24} hari` : undefined;
  };

  const per = WORK_UNIT[form.unit];
  const autoWork = autoWorkTime({ unit: form.unit, process: form.process });
  const workMissing = !autoWork && form.workMinutes.trim() === "";

  return (
    <form id={FORM_ID} onSubmit={submit} className="space-y-5">
      <Section title="Layanan">
        <Field label="Nama">
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
        <Field label="Kode" hint={editing ? "Tidak bisa diubah karena dipakai di nota." : "Terisi otomatis dari nama."}>
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
      </Section>

      <Section title="Harga">
        {rules.units.length > 1 && (
          <Field label="Dihitung">
            <Select value={form.unit} onChange={(e) => set({ unit: e.target.value as CatalogUnit })}>
              {rules.units.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={PRICE_LABEL[form.unit]}>{money(form.price, (price) => set({ price }), PRICE_LABEL[form.unit], "Belum ada")}</Field>
          {kiloan && (
            <>
              <Field label="Berat dasar">
                <Suffixed suffix="kg">{decimal(form.baseKg, (baseKg) => set({ baseKg }), true)}</Suffixed>
              </Field>
              <Field label="Per kg berikutnya" className="sm:col-span-2">
                {money(form.extra, (extra) => set({ extra }), "Per kg berikutnya")}
              </Field>
            </>
          )}
          {(form.unit === "KG" || form.unit === "LOAD") && (
            <Field label={form.unit === "KG" ? "Minimal (kg)" : "Minimal (pcs atau kg)"}>
              {decimal(form.minQty, (minQty) => set({ minQty }), false, "Tanpa minimal")}
            </Field>
          )}
        </div>
        {form.unit === "LOAD" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Isi satu load" className="sm:col-span-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <Segmented<LoadMode>
                  label="Satuan isi load"
                  value={form.loadMode}
                  onChange={(loadMode) => set({ loadMode })}
                  options={[
                    { value: "pcs", label: "pcs" },
                    { value: "kg", label: "kg" },
                  ]}
                />
                {decimal(form.perLoad, (perLoad) => set({ perLoad }), true)}
              </div>
            </Field>
            <Field label="Tambahan per pcs">{money(form.extra, (extra) => set({ extra }), "Tambahan per pcs")}</Field>
            <Field label="Maks tambahan per load">
              <Suffixed suffix="pcs">{decimal(form.maxExtra, (maxExtra) => set({ maxExtra }))}</Suffixed>
            </Field>
          </div>
        )}
      </Section>

      <Section title="Waktu">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`Lama kerja per ${per}`}
            hint={
              autoWork ? (
                "Kosong = dihitung dari mesin."
              ) : workMissing ? (
                <span className="text-warn-700">Isi supaya urutan antrean tepat.</span>
              ) : undefined
            }
          >
            <Suffixed suffix="menit">
              <input
                className={`${inputClass} tabular pr-16`}
                inputMode="decimal"
                value={form.workMinutes}
                placeholder={autoWork ? "Otomatis" : undefined}
                aria-invalid={workMissing || undefined}
                onChange={(e) => set({ workMinutes: e.target.value })}
              />
            </Suffixed>
          </Field>
          <Field label="Janji siap" hint={daysHint(form.promise, "Kosong = janji default.")}>
            {hours(form.promise, (promise) => set({ promise }), "Default")}
          </Field>
        </div>
      </Section>

      {kiloan && (
        <Section title="Express">
          <Switch
            label="Bisa Express"
            description="Harga Reguler × pengali Express."
            checked={form.express}
            onChange={(express) => set({ express })}
          />
          {form.express && (
            <div className="sm:max-w-[calc(50%-0.375rem)]">
              <Field label="Janji Express" hint={daysHint(form.expressPromise, "Harus lebih cepat dari Reguler.")}>
                {hours(form.expressPromise, (expressPromise) => set({ expressPromise }), "Default")}
              </Field>
            </div>
          )}
        </Section>
      )}

      <Section title="Status">
        <Switch
          label="Tampil di kasir"
          description={noPrice ? "Isi harga dulu." : undefined}
          checked={form.active && !noPrice}
          onChange={(active) => set({ active })}
        />
      </Section>

      <ErrorText message={error} />
    </form>
  );
}
