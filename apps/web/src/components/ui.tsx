import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentType,
  ReactNode,
  SelectHTMLAttributes,
  SVGProps,
} from "react";

import { STATUS_LABEL } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

import {
  IconAlert,
  IconBolt,
  IconCheck,
  IconChevronRight,
  IconInfo,
  IconMinus,
  IconPlus,
  IconSpinner,
} from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

// Status = titik + label. Label selalu tertulis, warna hanya penguat.
const STATUS_STYLE: Record<OrderStatus, string> = {
  RECEIVED: "text-muted",
  PROCESSING: "text-brand-600",
  READY: "text-ok-700",
  PICKED_UP: "text-faint",
  CANCELLED: "text-danger-600",
};

const stampClass = "inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium leading-none";
const dot = <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />;

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`${stampClass} ${STATUS_STYLE[status]}`}>
      {dot}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ExpressBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded bg-danger-50 px-1.5 py-0.5 text-xs font-medium leading-none text-danger-700 ${className}`}
    >
      <IconBolt size={11} className="fill-current" />
      Express
    </span>
  );
}

// Pesanan yang janjinya sudah dekat dibanding lama pengerjaannya, atau yang janjinya sudah lewat.
export function UrgentBadge({ late = false }: { late?: boolean }) {
  return late ? (
    <span
      title="Janji sudah lewat, kerjakan paling dulu"
      className="inline-flex items-center whitespace-nowrap rounded bg-danger-50 px-1.5 py-0.5 text-xs font-medium leading-none text-danger-700 ring-1 ring-inset ring-danger-600/25"
    >
      Terlambat
    </span>
  ) : (
    <span
      title="Janji sudah dekat, kerjakan lebih dulu"
      className="inline-flex items-center whitespace-nowrap rounded bg-warn-50 px-1.5 py-0.5 text-xs font-medium leading-none text-warn-700 ring-1 ring-inset ring-warn-600/25"
    >
      Segera
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="display text-2xl text-ink text-balance">{title}</h1>
        {description && <p className="mt-0.5 max-w-[68ch] text-sm text-muted text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Kartu angka ringkas (Dasbor, Jadwal Outlet): label, angka besar, keterangan kecil.
export function Kpi({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      <p className="label-caps text-muted">{label}</p>
      <p className="tabular display mt-1 truncate text-2xl text-ink">{value}</p>
      {sub && (
        <p className={`mt-1 flex items-center gap-1 text-sm ${warn ? "font-semibold text-warn-700" : "text-muted"}`}>
          {warn && <IconAlert size={13} />}
          {sub}
        </p>
      )}
    </div>
  );
}

export const cardClass = "rounded-2xl bg-surface shadow-card";

// icon dan tone tetap diterima agar pemanggil tidak berubah, tetapi kepala kartu sengaja tanpa ikon.
export type CardTone = "brand" | "ok" | "warn" | "neutral";

export function CardHeader({
  title,
  description,
  action,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: Icon;
  tone?: CardTone;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5">
      <div className="min-w-0">
        {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
        {description && <p className="text-sm text-muted text-pretty">{description}</p>}
      </div>
      {action && <div className="flex max-w-full shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}

export function Card({
  title,
  description,
  action,
  icon,
  tone,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: Icon;
  tone?: CardTone;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`${cardClass} ${className}`}>
      {(title || action) && (
        <CardHeader title={title} description={description} action={action} icon={icon} tone={tone} />
      )}
      {/* flow-root: margin anak pertama (mis. daftar tab) tidak bocor keluar kartu. */}
      <div className={flush ? "flow-root" : "px-4 pb-5 pt-3 sm:px-5"}>{children}</div>
    </section>
  );
}

// Daftar baris: dipisah garis, tidak ditumpuk sebagai kartu.
export const tileListClass = "space-y-2 px-3 pb-3 pt-1 sm:px-4 sm:pb-4";
export const tileClass = "rounded-xl bg-surface shadow-tile transition-shadow duration-150 hover:shadow-card";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "whatsapp" | "dark";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-raise hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-200 disabled:text-white disabled:shadow-none",
  secondary:
    "bg-surface text-ink-2 shadow-tile hover:bg-subtle active:bg-canvas disabled:bg-canvas disabled:text-faint disabled:shadow-none",
  danger:
    "bg-danger-600 text-white shadow-raise hover:bg-danger-700 disabled:bg-danger-50 disabled:text-danger-700/60",
  ghost: "text-ink-2 hover:bg-subtle active:bg-line/60 disabled:text-faint",
  whatsapp: "bg-ok-600 text-white shadow-raise hover:bg-ok-700 active:bg-ok-700 disabled:opacity-50",
  dark: "bg-ink text-white hover:bg-ink-2 disabled:opacity-50",
};

// Ringkas di desktop; di layar sentuh naik ke 44px supaya nyaman untuk jari.
const SIZE: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-lg gap-1.5 pointer-coarse:h-11",
  md: "h-10 px-4 text-base rounded-xl gap-2 pointer-coarse:h-11",
  lg: "h-11 px-5 text-base rounded-xl gap-2 pointer-coarse:h-12",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed ${SIZE[size]} ${VARIANT[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <IconSpinner size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return <a className={buttonClass(variant, size, className)} {...props} />;
}

export function IconButton({
  label,
  icon: Icon,
  className = "",
  size = 18,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: Icon; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink active:bg-line/60 disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent pointer-coarse:h-11 pointer-coarse:w-11 ${className}`}
      {...props}
    >
      <Icon size={size} />
    </button>
  );
}

// 16px di HP supaya Safari iOS tidak memperbesar layar saat input difokuskan.
const fieldBase =
  "block w-full rounded-xl border border-line-strong bg-subtle/60 px-3 text-[16px] text-ink shadow-[inset_0_1px_1px_rgb(16_24_40/0.03)] outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-faint hover:border-field focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-100 disabled:bg-subtle disabled:text-faint aria-invalid:border-danger-600 aria-invalid:ring-danger-50 sm:text-base";

export const inputClass = `${fieldBase} h-10 pointer-coarse:h-11`;

export const textareaClass = `${fieldBase} min-h-20 py-2`;

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className}`}>
      <select className={`${inputClass} cursor-pointer appearance-none pr-9`} {...props}>
        {children}
      </select>
      <IconChevronRight
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-muted"
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="label-caps mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; tone?: "brand" | "warn"; disabled?: boolean }[];
  label: string;
  size?: "md" | "lg";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-canvas p-1 ring-1 ring-inset ring-line"
    >
      {options.map((o) => {
        const active = o.value === value;
        const tone = o.tone === "warn" ? "text-danger-700 ring-1 ring-danger-600/30" : "text-ink ring-1 ring-line";
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:text-faint disabled:hover:text-faint ${
              size === "lg" ? "h-9 pointer-coarse:h-11" : "h-8 pointer-coarse:h-10"
            } ${active ? `bg-surface shadow-raise ${tone}` : "text-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  label: string;
  placeholder?: string;
}) {
  const n = Number(value) || 0;
  const step = "flex w-9 shrink-0 items-center justify-center text-muted hover:bg-subtle pointer-coarse:w-11";
  return (
    <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-line-strong bg-subtle/60 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100 pointer-coarse:h-11">
      <button
        type="button"
        aria-label={`Kurangi ${label}`}
        className={`${step} disabled:text-line-strong`}
        disabled={n <= min}
        onClick={() => onChange(String(Math.max(min, n - 1)))}
      >
        <IconMinus size={14} />
      </button>
      <input
        className="tabular w-full min-w-0 border-x border-line bg-transparent text-center text-[16px] text-ink outline-none placeholder:text-faint sm:text-base"
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
      <button type="button" aria-label={`Tambah ${label}`} className={step} onClick={() => onChange(String(n + 1))}>
        <IconPlus size={14} />
      </button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-base font-medium text-ink">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-5 w-9 rounded-full bg-line-strong transition-colors duration-150 peer-checked:bg-brand-600 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-100" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-raise transition-transform duration-150 peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

const ALERT: Record<"danger" | "info" | "success" | "warn", { box: string; icon: Icon }> = {
  danger: { box: "bg-danger-50 text-danger-700 ring-danger-600/20", icon: IconAlert },
  warn: { box: "bg-warn-50 text-warn-700 ring-warn-600/25", icon: IconAlert },
  info: { box: "bg-brand-50 text-brand-800 ring-brand-200", icon: IconInfo },
  success: { box: "bg-ok-50 text-ok-700 ring-ok-600/20", icon: IconCheck },
};

export function Alert({
  tone = "info",
  children,
  action,
  className = "",
}: {
  tone?: keyof typeof ALERT;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const a = ALERT[tone];
  const Icon = a.icon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${a.box} ${className}`}
    >
      <Icon size={16} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert tone="danger">{message}</Alert>;
}

export function Loading({ rows = 4, text = "Memuat..." }: { rows?: number; text?: string }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-live="polite">
      <span className="sr-only">{text}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-2/5" />
            <div className="skeleton h-3 w-3/5" />
          </div>
          <div className="skeleton h-8 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-muted">
        <Icon size={18} aria-hidden="true" />
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-xs text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SavedNote({ show, text = "Tersimpan" }: { show: boolean; text?: string }) {
  if (!show) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 text-sm font-medium text-ok-700">
      <IconCheck size={14} />
      {text}
    </span>
  );
}

// Pembayaran tampil sebagai cap stempel seperti di nota; garis putus-putus membedakan "belum" tanpa bergantung warna.
const paidStamp =
  "inline-flex -rotate-2 items-center whitespace-nowrap rounded-[3px] border-[1.5px] px-1.5 py-0.5 text-xs font-semibold uppercase leading-none tracking-[0.06em]";

export function PaymentBadge({ paid, className = "" }: { paid: boolean; className?: string }) {
  return paid ? (
    <span className={`${paidStamp} border-ok-600 text-ok-700 ${className}`}>Lunas</span>
  ) : (
    <span className={`${paidStamp} border-dashed border-warn-600 text-warn-700 ${className}`}>Belum lunas</span>
  );
}

// Tab bergaris bawah.
export const tabListClass = "m-3 flex gap-1 overflow-x-auto rounded-xl bg-canvas p-1 sm:m-4";

export function tabClass(active: boolean) {
  return `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150 pointer-coarse:h-11 ${
    active ? "bg-surface text-brand-700 shadow-tile" : "text-muted hover:bg-surface/70 hover:text-ink"
  }`;
}
