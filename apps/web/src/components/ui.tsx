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

/* ---------- Status ---------- */

const STATUS_STYLE: Record<OrderStatus, { chip: string; dot: string }> = {
  RECEIVED: { chip: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
  PROCESSING: { chip: "bg-brand-50 text-brand-700 ring-brand-100", dot: "bg-brand-500" },
  READY: { chip: "bg-ok-50 text-ok-700 ring-ok-600/15", dot: "bg-ok-600" },
  PICKED_UP: { chip: "bg-subtle text-faint ring-line", dot: "bg-line-strong" },
  CANCELLED: { chip: "bg-danger-50 text-danger-700 ring-danger-600/15", dot: "bg-danger-600" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ExpressBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warn-50 px-2 py-0.5 text-xs font-semibold text-warn-700 ring-1 ring-inset ring-warn-600/20 ${className}`}
    >
      <IconBolt size={12} className="fill-current" />
      Express
    </span>
  );
}

/* ---------- Layout ---------- */

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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink text-balance">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[68ch] text-sm text-muted text-pretty">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Wadah kartu: permukaan putih terangkat di atas kanvas, tanpa garis keras. */
export const cardClass = "rounded-2xl bg-surface shadow-card";

const CARD_ICON_TONE = {
  brand: "bg-brand-50 text-brand-600 ring-brand-100",
  ok: "bg-ok-50 text-ok-700 ring-ok-600/15",
  warn: "bg-warn-50 text-warn-700 ring-warn-600/15",
  neutral: "bg-canvas text-ink-2 ring-line",
} as const;

export type CardTone = keyof typeof CARD_ICON_TONE;

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
  tone = "brand",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: Icon;
  tone?: CardTone;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl bg-gradient-to-b from-tint to-surface px-4 pb-3 pt-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${CARD_ICON_TONE[tone]}`}
          >
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0">
          {title && <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>}
          {description && <p className="mt-0.5 text-[13px] text-muted text-pretty">{description}</p>}
        </div>
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
  /** Tanpa padding isi, untuk daftar yang menempel ke tepi. */
  flush?: boolean;
}) {
  return (
    <section className={`${cardClass} ${className}`}>
      {(title || action) && (
        <CardHeader title={title} description={description} action={action} icon={icon} tone={tone} />
      )}
      <div className={flush ? "" : "px-4 pb-5 pt-3 sm:px-5"}>{children}</div>
    </section>
  );
}

/** Daftar baris sebagai ubin terpisah di atas latar lembut, bukan dipisah garis. */
export const tileListClass = "space-y-2 px-3 pb-3 pt-1 sm:px-4 sm:pb-4";
export const tileClass =
  "rounded-xl bg-surface shadow-tile transition-shadow duration-150 hover:shadow-card";

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost" | "whatsapp" | "dark";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-raise hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-200 disabled:shadow-none",
  secondary:
    "bg-surface text-ink-2 shadow-tile hover:bg-subtle active:bg-canvas disabled:bg-canvas disabled:text-faint disabled:shadow-none",
  danger:
    "bg-danger-600 text-white shadow-raise hover:bg-danger-700 disabled:bg-danger-50 disabled:text-danger-600/50",
  ghost: "text-ink-2 hover:bg-canvas active:bg-line/60 disabled:text-faint",
  whatsapp:
    "bg-[#1a8f4c] text-white shadow-raise hover:bg-[#157a40] active:bg-[#11683a] disabled:opacity-50",
  dark: "bg-ink text-white hover:bg-ink-2 disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  sm: "h-9 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-11 px-4 text-sm rounded-xl gap-2",
  lg: "h-13 px-5 text-base rounded-xl gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed ${SIZE[size]} ${VARIANT[variant]} ${extra}`;
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

/** Tautan yang tampil sebagai tombol (tidak menumpuk <button> di dalam <a>). */
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
  size = 20,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: Icon; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink active:bg-line/60 disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent ${className}`}
      {...props}
    >
      <Icon size={size} />
    </button>
  );
}

/* ---------- Form ---------- */

// 16px supaya Safari iOS tidak memperbesar layar saat input difokuskan.
export const inputClass =
  "block h-11 w-full rounded-xl border border-line-strong bg-subtle/60 px-3 text-base text-ink shadow-[inset_0_1px_1px_rgb(16_24_40/0.03)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-faint/70 focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-100 disabled:bg-subtle disabled:text-faint aria-invalid:border-danger-600 aria-invalid:ring-danger-50";

export const textareaClass = inputClass.replace("h-11", "min-h-20 py-2.5");

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className}`}>
      <select className={`${inputClass} cursor-pointer appearance-none pr-10`} {...props}>
        {children}
      </select>
      <IconChevronRight
        size={16}
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
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
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
        const tone =
          o.tone === "warn"
            ? "bg-surface text-warn-700 ring-1 ring-warn-600/30 shadow-raise"
            : "bg-surface text-ink ring-1 ring-line shadow-raise";
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:text-faint disabled:hover:text-faint ${
              size === "lg" ? "h-12 text-[15px]" : "h-10 text-sm"
            } ${active ? tone : "text-muted hover:text-ink"}`}
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
  return (
    <div className="flex h-11 items-stretch overflow-hidden rounded-xl border border-line-strong bg-subtle/60 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
      <button
        type="button"
        aria-label={`Kurangi ${label}`}
        className="flex w-11 shrink-0 items-center justify-center text-muted hover:bg-canvas disabled:text-line-strong"
        disabled={n <= min}
        onClick={() => onChange(String(Math.max(min, n - 1)))}
      >
        <IconMinus size={16} />
      </button>
      <input
        className="tabular w-full min-w-0 border-x border-line bg-transparent text-center text-base text-ink outline-none placeholder:text-faint"
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
      <button
        type="button"
        aria-label={`Tambah ${label}`}
        className="flex w-11 shrink-0 items-center justify-center text-muted hover:bg-canvas"
        onClick={() => onChange(String(n + 1))}
      >
        <IconPlus size={16} />
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
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-line-strong transition-colors duration-150 peer-checked:bg-brand-600 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-100" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-raise transition-transform duration-150 peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

/* ---------- Feedback ---------- */

const ALERT: Record<"danger" | "info" | "success" | "warn", { box: string; icon: Icon }> = {
  danger: { box: "bg-danger-50 text-danger-700 ring-danger-600/15", icon: IconAlert },
  warn: { box: "bg-warn-50 text-warn-700 ring-warn-600/20", icon: IconAlert },
  info: { box: "bg-brand-50 text-brand-800 ring-brand-100", icon: IconInfo },
  success: { box: "bg-ok-50 text-ok-700 ring-ok-600/15", icon: IconCheck },
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
      className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${a.box} ${className}`}
    >
      <Icon size={18} className="mt-px shrink-0" />
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
    <div className="space-y-3 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{text}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-9 w-9 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-2/5" />
            <div className="skeleton h-3 w-3/5" />
          </div>
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
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 ring-1 ring-inset ring-brand-100">
        <Icon size={22} />
      </span>
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SavedNote({ show, text = "Tersimpan" }: { show: boolean; text?: string }) {
  if (!show) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 text-sm font-medium text-ok-700">
      <IconCheck size={16} />
      {text}
    </span>
  );
}

/** Status bayar: tidak hanya warna, selalu ada teks. */
export function PaymentBadge({ paid, className = "" }: { paid: boolean; className?: string }) {
  return paid ? (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ok-50 px-2 py-0.5 text-xs font-semibold text-ok-700 ring-1 ring-inset ring-ok-600/15 ${className}`}
    >
      <IconCheck size={12} />
      Lunas
    </span>
  ) : (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full bg-warn-50 px-2 py-0.5 text-xs font-semibold text-warn-700 ring-1 ring-inset ring-warn-600/20 ${className}`}
    >
      Belum lunas
    </span>
  );
}
