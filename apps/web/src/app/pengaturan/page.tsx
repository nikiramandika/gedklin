"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type FormEvent, type ReactNode, type SVGProps } from "react";

import { AppShell, ROLE_LABEL } from "@/components/AppShell";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { IconBolt, IconCalendar, IconClock, IconKey, IconSparkles, IconStore, IconUser } from "@/components/icons";
import { ConfirmDialog } from "@/components/overlay";
import {
  Button,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  SavedNote,
  Segmented,
  Stepper,
  cardClass,
  inputClass,
  tabClass,
  textareaClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PROCESS_LABEL, initials } from "@/lib/format";
import { WEEKDAYS, WEEKDAY_NAMES, describeWeek, hhmm } from "@/lib/schedule";
import type { AiProvider, AiSettings, AppSettings, Role, ServicePromise, User } from "@/lib/types";

const ROLES: Role[] = ["owner", "cashier", "staff"];

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
type SectionId = "akun" | "outlet" | "jadwal" | "pengerjaan" | "harga" | "ai";

const SECTIONS: { id: SectionId; label: string; icon: IconComponent }[] = [
  { id: "akun", label: "Akun saya", icon: IconUser },
  { id: "outlet", label: "Outlet", icon: IconStore },
  { id: "jadwal", label: "Jadwal", icon: IconCalendar },
  { id: "pengerjaan", label: "Waktu pengerjaan", icon: IconClock },
  { id: "harga", label: "Express & janji", icon: IconBolt },
  { id: "ai", label: "Analisis AI", icon: IconSparkles },
];

const KEY_LINK: Record<AiProvider, { href: string; label: string }> = {
  gemini: { href: "https://aistudio.google.com/apikey", label: "Google AI Studio" },
  openrouter: { href: "https://openrouter.ai/keys", label: "OpenRouter" },
};

type SettingsBody = Partial<Record<keyof AppSettings, unknown>>;

const num = (v: string) => Number(v.replace(",", "."));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function PengaturanPage() {
  return (
    <AppShell roles={ROLES}>
      <PengaturanContent />
    </AppShell>
  );
}

function sectionFromHash(): SectionId {
  const hash = window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === hash) ? (hash as SectionId) : "akun";
}

// Dirender hanya setelah login (di klien), jadi hash URL aman dibaca saat render pertama.
function PengaturanContent() {
  const { user } = useAuth();
  const owner = user?.role === "owner";
  const [active, setActive] = useState<SectionId>(() => (owner ? sectionFromHash() : "akun"));

  useEffect(() => {
    if (!owner) return;
    const onHash = () => setActive(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [owner]);

  function open(id: SectionId) {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  }

  if (!user) return null;

  if (!owner) {
    return (
      <>
        <PageHeader title="Pengaturan" />
        <div className="max-w-3xl">
          <ProfileForm user={user} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Pengaturan" />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <SectionNav active={active} onOpen={open} />
        <div className="min-w-0 max-w-3xl">
          <Panel id="akun" active={active} title="Akun saya">
            <ProfileForm user={user} />
          </Panel>
          <OwnerPanels active={active} />
        </div>
      </div>
    </>
  );
}

function SectionNav({ active, onOpen }: { active: SectionId; onOpen: (id: SectionId) => void }) {
  const link = (s: (typeof SECTIONS)[number], className: string, children: ReactNode) => (
    <a
      href={`#${s.id}`}
      aria-current={active === s.id ? "true" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onOpen(s.id);
      }}
      className={className}
    >
      {children}
    </a>
  );

  return (
    <nav aria-label="Bagian pengaturan" className="lg:sticky lg:top-6">
      {/* HP & tablet: strip tab yang bisa digeser, rata dengan tepi halaman. */}
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:hidden">
        {SECTIONS.map((s) => (
          <li key={s.id} className="shrink-0">
            {link(s, tabClass(active === s.id), s.label)}
          </li>
        ))}
      </ul>
      <ul className="hidden space-y-0.5 lg:block">
        {SECTIONS.map((s) => {
          const current = active === s.id;
          const Icon = s.icon;
          return (
            <li key={s.id}>
              {link(
                s,
                `flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors duration-150 ${
                  current ? "bg-surface text-ink shadow-tile" : "text-muted hover:bg-surface/60 hover:text-ink"
                }`,
                <>
                  <Icon size={17} className={current ? "text-brand-600" : "text-faint"} />
                  {s.label}
                </>,
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Panel yang tidak aktif tetap terpasang (hanya disembunyikan) supaya isian yang belum disimpan tidak hilang.
function Panel({
  id,
  active,
  title,
  description,
  children,
}: {
  id: SectionId;
  active: SectionId;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`panel-${id}-title`} hidden={active !== id}>
      <header className="mb-4">
        <h2 id={`panel-${id}-title`} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted text-pretty">{description}</p>}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function OwnerPanels({ active }: { active: SectionId }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AppSettings>("/settings")
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    api<AiSettings>("/settings/ai")
      .then(setAi)
      .catch((e: Error) => setError(e.message));
  }, []);

  const placeholder = <PanelLoading error={error} />;

  return (
    <>
      <Panel id="outlet" active={active} title="Outlet" description="Tampil di nota dan pesan WhatsApp.">
        {settings ? <OutletForm settings={settings} onSaved={setSettings} /> : placeholder}
      </Panel>

      <Panel id="jadwal" active={active} title="Jadwal">
        {settings ? <ScheduleForm settings={settings} onSaved={setSettings} /> : placeholder}
      </Panel>

      <Panel
        id="pengerjaan"
        active={active}
        title="Waktu pengerjaan"
        description="Dipakai untuk mengurutkan antrean: cucian yang paling mepet janji dikerjakan duluan."
      >
        {settings ? <WorkTimeForm settings={settings} onSaved={setSettings} /> : placeholder}
      </Panel>

      <Panel id="harga" active={active} title="Express & janji">
        {settings ? <PricingForm settings={settings} onSaved={setSettings} /> : placeholder}
        <PromiseForm />
      </Panel>

      <Panel id="ai" active={active} title="Analisis AI">
        {ai ? <AiForm settings={ai} onSaved={setAi} /> : placeholder}
      </Panel>
    </>
  );
}

function PanelLoading({ error }: { error: string | null }) {
  return (
    <div className={cardClass}>
      {error ? (
        <div className="p-5">
          <ErrorText message={error} />
        </div>
      ) : (
        <Loading rows={4} />
      )}
    </div>
  );
}

/* ---------- Kerangka form ---------- */

function FormCard({
  onSubmit,
  footer,
  children,
}: {
  onSubmit: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <form
      className={cardClass}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-6 p-4 sm:p-6">{children}</div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 sm:px-6">{footer}</div>
    </form>
  );
}

function SettingsForm({
  onSubmit,
  dirty,
  busy,
  saved,
  error,
  children,
}: {
  onSubmit: () => void;
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <FormCard
      onSubmit={onSubmit}
      footer={
        <>
          <Button type="submit" loading={busy} disabled={!dirty}>
            Simpan
          </Button>
          <SavedNote show={saved && !dirty} />
        </>
      }
    >
      {children}
      <ErrorText message={error} />
    </FormCard>
  );
}

function Group({ title, description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      {title && (
        <div className="mb-4">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      )}
      {children}
    </div>
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

function useSettingsSave(onSaved: (s: AppSettings) => void) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: SettingsBody) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api<AppSettings>("/settings", { method: "PUT", body }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return { busy, saved, error, save };
}

/* ---------- Akun saya ---------- */

function ProfileForm({ user }: { user: User }) {
  const { updateUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const dirty = name.trim() !== "" && name.trim() !== user.name;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      updateUser(await api<User>("/auth/me", { method: "PUT", body: { name } }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingsForm onSubmit={save} dirty={dirty} busy={busy} saved={saved} error={error}>
        <Group>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
              {initials(user.name)}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-base font-semibold text-ink">{user.name}</p>
              <p className="text-sm text-muted">
                @{user.username} · {ROLE_LABEL[user.role]}
              </p>
            </div>
          </div>
        </Group>
        <Group>
          <div className="space-y-4">
            <Field label="Nama" className="max-w-md">
              <input
                className={inputClass}
                value={name}
                maxLength={100}
                autoComplete="name"
                onChange={(e) => {
                  setSaved(false);
                  setName(e.target.value);
                }}
              />
            </Field>
            <div>
              <span className="label-caps mb-1.5 block">Password</span>
              <Button variant="secondary" onClick={() => setChangingPassword(true)}>
                <IconKey size={18} />
                Ganti password
              </Button>
            </div>
          </div>
        </Group>
      </SettingsForm>
      <ChangePasswordModal open={changingPassword} onClose={() => setChangingPassword(false)} />
    </>
  );
}

/* ---------- Outlet ---------- */

function OutletForm({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const initial = { name: settings.outlet_name, address: settings.outlet_address, phone: settings.outlet_phone };
  const [v, setV] = useState(initial);
  const { busy, saved, error, save } = useSettingsSave(onSaved);
  const set = (patch: Partial<typeof v>) => setV((cur) => ({ ...cur, ...patch }));

  return (
    <SettingsForm
      onSubmit={() => save({ outlet_name: v.name, outlet_address: v.address, outlet_phone: v.phone })}
      dirty={!same(v, initial) && v.name.trim() !== ""}
      busy={busy}
      saved={saved}
      error={error}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-4">
          <Field label="Nama outlet">
            <input className={inputClass} value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Alamat (opsional)">
            <textarea
              className={textareaClass}
              value={v.address}
              maxLength={200}
              rows={2}
              onChange={(e) => set({ address: e.target.value })}
            />
          </Field>
          <Field label="Nomor telepon (opsional)" className="max-w-xs">
            <input
              className={`${inputClass} tabular`}
              inputMode="tel"
              value={v.phone}
              maxLength={30}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
        </div>
        <div aria-hidden="true">
          <span className="label-caps mb-1.5 block">Di nota</span>
          <div className="rounded-xl border border-dashed border-line-strong bg-subtle/60 px-4 py-5 text-center font-mono text-xs leading-relaxed text-ink">
            <p className="break-words text-sm font-semibold tracking-wide">{(v.name.trim() || "Nama outlet").toUpperCase()}</p>
            {v.address.trim() && <p className="break-words">{v.address.trim()}</p>}
            {v.phone.trim() && <p>{v.phone.trim()}</p>}
            <div className="mt-3 space-y-1.5 border-t border-dashed border-line-strong pt-3">
              <span className="mx-auto block h-1.5 w-4/5 rounded-full bg-line" />
              <span className="mx-auto block h-1.5 w-3/5 rounded-full bg-line" />
            </div>
          </div>
        </div>
      </div>
    </SettingsForm>
  );
}

/* ---------- Jadwal ---------- */

function ScheduleForm({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const initial = {
    closed: [...settings.closed_weekdays].sort(),
    open_time: hhmm(settings.default_open_time),
    close_time: hhmm(settings.default_close_time),
    staff: String(settings.default_staff_on_duty),
    washers: String(settings.default_washers_available),
    dryers: String(settings.default_dryers_available),
  };
  const [v, setV] = useState(initial);
  const { busy, saved, error, save } = useSettingsSave(onSaved);
  const allClosed = v.closed.length >= 7;

  function update<K extends keyof typeof v>(key: K, value: (typeof v)[K]) {
    setV((cur) => ({ ...cur, [key]: value }));
  }

  function toggle(d: number) {
    update("closed", v.closed.includes(d) ? v.closed.filter((x) => x !== d) : [...v.closed, d].sort());
  }

  return (
    <>
      <SettingsForm
        onSubmit={() =>
          save({
            closed_weekdays: v.closed,
            default_open_time: v.open_time,
            default_close_time: v.close_time,
            default_staff_on_duty: Number(v.staff),
            default_washers_available: Number(v.washers),
            default_dryers_available: Number(v.dryers),
          })
        }
        dirty={!same(v, initial) && !allClosed}
        busy={busy}
        saved={saved}
        error={error}
      >
        <Group title="Hari & jam buka" description={allClosed ? undefined : describeWeek(v.closed)}>
          <div className="space-y-4">
            <div role="group" aria-label="Hari buka" className="grid max-w-md grid-cols-7 gap-1.5">
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
            {allClosed && <ErrorText message="Minimal satu hari harus buka." />}
            <div className="grid max-w-md grid-cols-2 gap-4">
              <Field label="Buka">
                <input className={inputClass} type="time" value={v.open_time} onChange={(e) => update("open_time", e.target.value)} />
              </Field>
              <Field label="Tutup">
                <input className={inputClass} type="time" value={v.close_time} onChange={(e) => update("close_time", e.target.value)} />
              </Field>
            </div>
          </div>
        </Group>
        <Group title="Petugas & mesin">
          <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
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
        </Group>
      </SettingsForm>
      <p className="text-sm text-muted">
        Libur atau mesin rusak di tanggal tertentu?{" "}
        <Link href="/dasbor/operasional" className="font-medium text-brand-700 underline underline-offset-2">
          Catat di Jadwal Outlet
        </Link>
      </p>
    </>
  );
}

/* ---------- Waktu pengerjaan ---------- */

// Hitungan sama dengan backend (services/queue.py).
function exampleHours(s: AppSettings, v: Record<string, string>, kg: number): number | null {
  const capacity = num(v.capacity);
  const minutes = [num(v.wash), num(v.dry), num(v.ironKg)];
  if (!(capacity > 0) || minutes.some((x) => !Number.isFinite(x) || x < 0)) return null;
  const loads = Math.ceil(kg / capacity);
  const wash = Math.ceil(loads / Math.max(s.default_washers_available, 1)) * minutes[0];
  const dry = Math.ceil(loads / Math.max(s.default_dryers_available, 1)) * minutes[1];
  const iron = (kg * minutes[2]) / Math.max(s.default_staff_on_duty, 1);
  return (wash + dry + iron) / 60;
}

function WorkTimeForm({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const initial = {
    capacity: String(settings.machine_capacity_kg),
    wash: String(settings.wash_minutes_per_load),
    dry: String(settings.dry_minutes_per_load),
    ironKg: String(settings.iron_minutes_per_kg),
    ironPcs: String(settings.iron_minutes_per_pcs),
  };
  const [v, setV] = useState(initial);
  const { busy, saved, error, save } = useSettingsSave(onSaved);
  const example = exampleHours(settings, v, 10);

  const field = (key: keyof typeof v, label: string, suffix: string) => (
    <Field label={label}>
      <Suffixed suffix={suffix}>
        <input
          className={`${inputClass} tabular pr-16`}
          inputMode="decimal"
          value={v[key]}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
        />
      </Suffixed>
    </Field>
  );

  return (
    <SettingsForm
      onSubmit={() =>
        save({
          machine_capacity_kg: num(v.capacity),
          wash_minutes_per_load: num(v.wash),
          dry_minutes_per_load: num(v.dry),
          iron_minutes_per_kg: num(v.ironKg),
          iron_minutes_per_pcs: num(v.ironPcs),
        })
      }
      dirty={!same(v, initial)}
      busy={busy}
      saved={saved}
      error={error}
    >
      <Group title="Mesin cuci">
        <div className="max-w-[12rem]">{field("capacity", "Muatan sekali cuci", "kg")}</div>
      </Group>
      <Group title="Lama tiap tahap">
        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          {field("wash", "Cuci", "menit")}
          {field("dry", "Pengeringan", "menit")}
          {field("ironKg", "Setrika per kg", "menit")}
          {field("ironPcs", "Setrika per potong", "menit")}
        </div>
      </Group>
      {example !== null && (
        <p className="rounded-xl bg-subtle px-4 py-3 text-sm text-ink-2" aria-live="polite">
          Cucian 10 kg cuci-setrika selesai dalam ±{" "}
          <span className="tabular font-semibold text-ink">
            {example.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam
          </span>
        </p>
      )}
    </SettingsForm>
  );
}

/* ---------- Express & janji ---------- */

function PricingForm({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const initial = { multiplier: String(settings.express_multiplier), promise: String(settings.default_promise_hours) };
  const [v, setV] = useState(initial);
  const { busy, saved, error, save } = useSettingsSave(onSaved);

  return (
    <SettingsForm
      onSubmit={() => save({ express_multiplier: num(v.multiplier), default_promise_hours: Number(v.promise) })}
      dirty={!same(v, initial)}
      busy={busy}
      saved={saved}
      error={error}
    >
      <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Harga Express" hint="Kali harga Reguler.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">×</span>
            <input
              className={`${inputClass} tabular pl-8`}
              inputMode="decimal"
              value={v.multiplier}
              onChange={(e) => setV({ ...v, multiplier: e.target.value })}
            />
          </div>
        </Field>
        <Field label="Janji default" hint="Untuk layanan tanpa janji.">
          <Suffixed suffix="jam">
            <input
              className={`${inputClass} tabular pr-12`}
              type="number"
              min={1}
              value={v.promise}
              onChange={(e) => setV({ ...v, promise: e.target.value })}
            />
          </Suffixed>
        </Field>
      </div>
    </SettingsForm>
  );
}

function hoursValue(v: string): number | null {
  return v.trim() === "" ? null : Number(v);
}

function PromiseForm() {
  const [rows, setRows] = useState<ServicePromise[] | null>(null);
  const [initial, setInitial] = useState<ServicePromise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<ServicePromise[]>("/service-promises")
      .then((r) => {
        setRows(r);
        setInitial(r);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save() {
    if (!rows) return;
    setError(null);
    setBusy(true);
    try {
      await Promise.all(
        rows.map((r) =>
          api(`/service-promises/${r.process}`, {
            method: "PUT",
            body: { regular_hours: r.regular_hours, express_hours: r.express_hours, min_regular_hours: r.min_regular_hours },
          }),
        ),
      );
      setInitial(rows);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <PanelLoading error={error} />;

  const hoursInput = (i: number, key: "regular_hours" | "express_hours", label: string) => (
    <input
      className={`${inputClass} tabular px-2.5 text-center`}
      type="number"
      min={1}
      placeholder="–"
      value={rows[i][key] ?? ""}
      onChange={(e) => {
        setSaved(false);
        const value = hoursValue(e.target.value);
        setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
      }}
      aria-label={`${label} ${PROCESS_LABEL[rows[i].process]} (jam)`}
    />
  );

  return (
    <SettingsForm onSubmit={save} dirty={!same(rows, initial)} busy={busy} saved={saved} error={error}>
      <Group title="Janji per layanan" description="Dalam jam.">
        <div className="max-w-xl">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-3 border-b border-line pb-2 text-sm font-medium text-muted">
            <span>Layanan</span>
            <span className="text-center">Reguler</span>
            <span className="text-center">Express</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((r, i) => (
              <li key={r.process} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-3 py-2">
                <span className="text-sm text-ink-2">{PROCESS_LABEL[r.process]}</span>
                {hoursInput(i, "regular_hours", "Janji Reguler")}
                {hoursInput(i, "express_hours", "Janji Express")}
              </li>
            ))}
          </ul>
        </div>
      </Group>
    </SettingsForm>
  );
}

/* ---------- Analisis AI ---------- */

function AiForm({ settings, onSaved }: { settings: AiSettings; onSaved: (s: AiSettings) => void }) {
  const defaultModel = (p: AiProvider) => settings.providers.find((x) => x.id === p)?.default_model ?? "";
  const providerLabel = settings.providers.find((x) => x.id === settings.provider)?.label ?? settings.provider;
  const initialModel = settings.model === defaultModel(settings.provider) ? "" : settings.model;
  const [provider, setProvider] = useState<AiProvider>(settings.provider);
  const [model, setModel] = useState(initialModel);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const providerChanged = provider !== settings.provider;
  // Key milik penyedia lain tidak berlaku, jadi wajib diisi ulang saat ganti penyedia.
  const keyRequired = !settings.has_key || providerChanged;
  const dirty = providerChanged || model.trim() !== initialModel || apiKey.trim() !== "";

  async function run(kind: "save" | "test" | "clear") {
    setError(null);
    setNotice(null);
    if (kind !== "clear" && keyRequired && !apiKey.trim()) {
      setError("Isi API key dulu.");
      return;
    }
    setBusy(kind);
    try {
      if (kind !== "test" || dirty) {
        const s = await api<AiSettings>("/settings/ai", {
          method: "PUT",
          body: { provider, model: model.trim() || null, api_key: apiKey.trim() || null, clear_key: kind === "clear" },
        });
        onSaved(s);
        setApiKey("");
        if (kind === "clear") setModel("");
      }
      if (kind === "test") {
        await api("/settings/ai/test", { method: "POST" });
        setNotice("Koneksi berhasil");
      } else {
        setNotice(kind === "clear" ? "API key dihapus" : "Tersimpan");
      }
      setConfirmClear(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  }

  const link = KEY_LINK[provider];

  return (
    <>
      <FormCard
        onSubmit={() => run("save")}
        footer={
          <>
            <Button type="submit" loading={busy === "save"} disabled={!!busy || !dirty}>
              Simpan
            </Button>
            <Button
              variant="secondary"
              loading={busy === "test"}
              disabled={!!busy || (!settings.has_key && !apiKey.trim())}
              onClick={() => run("test")}
            >
              Uji koneksi
            </Button>
            <SavedNote show={notice !== null && !dirty} text={notice ?? undefined} />
            {settings.has_key && (
              <Button
                variant="ghost"
                className="ml-auto text-danger-700"
                disabled={!!busy}
                onClick={() => setConfirmClear(true)}
              >
                Hapus API key
              </Button>
            )}
          </>
        }
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            {settings.has_key ? `Memakai ${providerLabel}` : "Isi API key agar Analisis AI bisa dipakai."}
          </p>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
              settings.has_key ? "bg-ok-50 text-ok-700 ring-ok-600/25" : "bg-subtle text-muted ring-line"
            }`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${settings.has_key ? "bg-ok-600" : "bg-faint"}`} />
            {settings.has_key ? "Aktif" : "Belum aktif"}
          </span>
        </div>

        <div className="max-w-xl space-y-4">
          <div>
            <span className="label-caps mb-1.5 block">Penyedia</span>
            <Segmented<AiProvider>
              label="Penyedia AI"
              value={provider}
              onChange={setProvider}
              options={settings.providers.map((p) => ({ value: p.id, label: p.label }))}
            />
          </div>
          <Field
            label="API key"
            hint={
              <>
                Dapatkan di{" "}
                <a className="font-medium text-brand-700 underline underline-offset-2" href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </>
            }
          >
            <input
              className={inputClass}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.has_key && !providerChanged ? "Sudah tersimpan" : "Tempel API key di sini"}
            />
          </Field>
          <details className="group">
            <summary className="cursor-pointer list-none text-sm font-medium text-brand-700 [&::-webkit-details-marker]:hidden">
              <span className="underline underline-offset-2">Lanjutan</span>
            </summary>
            <Field label="Model" hint={`Kosongkan untuk memakai bawaan (${defaultModel(provider)}).`} className="mt-3">
              <input
                className={inputClass}
                value={model}
                spellCheck={false}
                onChange={(e) => setModel(e.target.value)}
                placeholder={defaultModel(provider)}
              />
            </Field>
          </details>
        </div>

        <ErrorText message={error} />

        <p className="border-t border-line pt-4 text-sm text-muted">
          Hanya angka ringkasan laporan yang dikirim ke AI, tanpa data pelanggan. Pertanyaan di luar laporan tidak dijawab.
        </p>
      </FormCard>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => run("clear")}
        title="Hapus API key?"
        confirmLabel="Hapus"
        busy={busy === "clear"}
        error={confirmClear ? error : null}
      >
        Analisis AI tidak bisa dipakai sampai API key diisi lagi.
      </ConfirmDialog>
    </>
  );
}
