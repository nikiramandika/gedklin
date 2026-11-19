import type {
  CatalogGroup,
  CatalogItem,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  Process,
  TrackingItem,
} from "./types";

const TZ = "Asia/Jakarta";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  RECEIVED: "Diterima",
  PROCESSING: "Diproses",
  READY: "Siap Diambil",
  PICKED_UP: "Sudah Diambil",
  CANCELLED: "Dibatalkan",
};

export const STATUS_ACTION: Record<OrderStatus, string> = {
  RECEIVED: "Terima",
  PROCESSING: "Mulai Proses",
  READY: "Tandai Siap",
  PICKED_UP: "Tandai Diambil",
  CANCELLED: "Batalkan",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  TRANSFER: "Transfer",
};

export function paymentLabel(order: { is_paid: boolean; payment_method: PaymentMethod | null }): string {
  if (!order.is_paid) return "Belum lunas";
  return order.payment_method ? `Lunas · ${PAYMENT_LABEL[order.payment_method]}` : "Lunas";
}

export const GROUP_LABEL: Record<CatalogGroup, string> = {
  KILOAN: "Kiloan",
  SETRIKA: "Setrika saja",
  KHUSUS: "Item khusus",
  SATUAN: "Satuan",
  DRY_CLEAN: "Dry clean",
};

export const PROCESS_LABEL: Record<Process, string> = {
  C: "Cuci",
  CK: "Cuci + Kering",
  CKL: "Cuci + Kering + Lipat",
  CKS: "Cuci + Kering + Setrika",
  S: "Setrika saja",
  SATUAN: "Satuan (manual)",
  DRY_CLEAN: "Dry clean",
};

export function speedLabel(express: boolean): string {
  return express ? "Express" : "Reguler";
}

export function formatKg(value: string | number): string {
  return `${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
}

export function describeItem(item: TrackingItem): string {
  const parts = [item.name];
  if (item.weight_kg !== null) parts.push(formatKg(item.weight_kg));
  if (item.qty_pcs) parts.push(`${item.weight_kg !== null ? "+" : ""}${item.qty_pcs} pcs`);
  return parts.join(" ");
}

// Sama dengan aturan server: nomor HP Indonesia 08xx, total 10-13 digit. Pelanggan tanpa
// WhatsApp boleh memakai nomor rumah (kode area 02x-09x).
export function cleanPhoneInput(raw: string): string {
  return raw.replace(/[^\d\s+().-]/g, "");
}

export function phoneError(raw: string, mobileOnly = true): string | null {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return mobileOnly ? "Isi nomor WhatsApp." : "Isi nomor telepon.";
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  if (!mobileOnly && /^62[2-79]/.test(digits)) {
    return /^62[2-79]\d{6,11}$/.test(digits) ? null : "Nomor telepon tidak valid.";
  }
  if (!digits.startsWith("628")) return "Pakai nomor HP yang diawali 08.";
  if (digits.length < 11) return "Nomor terlalu pendek (minimal 10 digit).";
  if (digits.length > 14) return "Nomor terlalu panjang (maksimal 13 digit).";
  return null;
}

// 6281234567890 -> 0812-3456-7890, format yang dikenali kasir dan pelanggan.
export function displayPhone(phone: string): string {
  const local = phone.startsWith("62") ? `0${phone.slice(2)}` : phone;
  return local.replace(/^(d{4})(d{4})(d+)$/, "$1-$2-$3");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function summarizeItems(items: TrackingItem[]): string {
  return items.map(describeItem).join(", ");
}

export function lineDetail(item: OrderItem): string {
  const parts: string[] = [];
  if (item.machine_loads) {
    parts.push(`${item.machine_loads} load${item.group === "KILOAN" ? " mesin" : ""}`);
  }
  if (item.extra_kg) parts.push(`+${formatKg(item.extra_kg)} tambahan`);
  if (item.extra_pcs) parts.push(`+${item.extra_pcs} pcs`);
  if (item.is_express) parts.push("Express");
  return parts.join(" · ");
}

export function itemInputs(item: CatalogItem): { weight: boolean; pcs: boolean; pcsLabel: string } {
  if (item.unit === "KILOAN_7KG" || item.unit === "KG") return { weight: true, pcs: false, pcsLabel: "" };
  if (item.unit === "LOAD" && item.kg_per_load)
    return { weight: true, pcs: true, pcsLabel: "Tambahan (pcs)" };
  return { weight: false, pcs: true, pcsLabel: "Jumlah (pcs)" };
}

export function priceRule(item: CatalogItem): string {
  if (item.price === null) return "Harga belum ditetapkan";
  const price = formatRupiah(item.price);
  const extra = item.extra_price ? formatRupiah(item.extra_price) : null;
  switch (item.unit) {
    case "KILOAN_7KG":
      return `${price} s/d ${item.base_kg ?? 7} kg${extra ? ` + ${extra}/kg berikutnya` : ""}`;
    case "KG":
      return `${price}/kg${item.min_qty ? `, min. ${item.min_qty} kg` : ""}`;
    case "PCS":
      return `${price}/pcs`;
    case "LOAD": {
      const cap = item.kg_per_load ? `${item.kg_per_load} kg` : `${item.pcs_per_load} pcs`;
      return `${price}/load ${cap}${extra ? ` + ${extra}/pcs (maks ${item.max_extra ?? 0})` : ""}`;
    }
  }
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

// Label sumbu grafik: "Jum", "13", "Nov" terpisah agar bisa ditumpuk dan bulan disembunyikan di layar sempit.
export function formatWeekdayDay(iso: string): { weekday: string; day: string; month: string } {
  const date = new Date(`${iso}T00:00:00+07:00`);
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("id-ID", { timeZone: TZ, ...opts }).format(date);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
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

export function relativeEta(iso: string | null, now: number): string {
  if (!iso || !now) return "";
  const diff = Math.round((new Date(iso).getTime() - now) / 60000);
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const text =
    d > 0 ? `${d} hari${h > 0 ? ` ${h} jam` : ""}` : h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
  return diff >= 0 ? `${text} lagi` : `lewat ${text}`;
}

// "late" diukur dari janji standar, bukan dari perkiraan.
export type EtaState = "late" | "due" | "on_track";

export function etaState(
  o: { promised_ready_at: string | null; predicted_ready_at: string | null; ready_at: string | null },
  now: number,
): EtaState | null {
  if (o.ready_at) return null;
  if (!now) return "on_track";
  if (o.promised_ready_at && new Date(o.promised_ready_at).getTime() < now) return "late";
  if (o.predicted_ready_at && new Date(o.predicted_ready_at).getTime() < now) return "due";
  return "on_track";
}
