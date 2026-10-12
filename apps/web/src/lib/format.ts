import type { OrderStatus, ServiceType } from "./types";

const TZ = "Asia/Jakarta";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  RECEIVED: "Diterima",
  WASHING: "Dicuci",
  DRYING: "Dikeringkan",
  IRONING: "Disetrika",
  READY: "Siap Diambil",
  PICKED_UP: "Sudah Diambil",
};

export const STATUS_ACTION: Record<OrderStatus, string> = {
  RECEIVED: "Terima",
  WASHING: "Mulai Cuci",
  DRYING: "Mulai Kering",
  IRONING: "Mulai Setrika",
  READY: "Tandai Siap",
  PICKED_UP: "Tandai Diambil",
};

export const SERVICE_LABEL: Record<ServiceType, string> = {
  CK: "Cuci Kering",
  CKS: "Cuci Kering Setrika",
};

export function serviceLabel(type: ServiceType, express: boolean): string {
  return `${type} ${express ? "Express" : "Reguler"}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${iso}T00:00:00+07:00`));
}

export function formatRupiah(value: string | number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** "2 jam 15 menit lagi" / "lewat 30 menit" */
export function relativeEta(iso: string | null, now: number): string {
  if (!iso || !now) return "";
  const diff = Math.round((new Date(iso).getTime() - now) / 60000);
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const text = h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
  return diff >= 0 ? `${text} lagi` : `lewat ${text}`;
}
