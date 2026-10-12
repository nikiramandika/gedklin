import type { CatalogGroup, CatalogItem, OrderStatus, Process, TrackingItem } from "./types";

const TZ = "Asia/Jakarta";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  RECEIVED: "Diterima",
  PROCESSING: "Diproses",
  READY: "Siap Diambil",
  PICKED_UP: "Sudah Diambil",
};

export const STATUS_ACTION: Record<OrderStatus, string> = {
  RECEIVED: "Terima",
  PROCESSING: "Mulai Proses",
  READY: "Tandai Siap",
  PICKED_UP: "Tandai Diambil",
};

export const GROUP_LABEL: Record<CatalogGroup, string> = {
  KILOAN: "Kiloan",
  SETRIKA: "Setrika saja",
  KHUSUS: "Item khusus",
  SATUAN: "Satuan",
};

export const PROCESS_LABEL: Record<Process, string> = {
  C: "Cuci",
  CK: "Cuci + Kering",
  CKL: "Cuci + Kering + Lipat",
  CKS: "Cuci + Kering + Setrika",
  S: "Setrika saja",
  SATUAN: "Satuan",
};

export function speedLabel(express: boolean): string {
  return express ? "Express" : "Reguler";
}

/** "Cuci + Kering + Setrika 8 kg" / "Kemeja Lengan Panjang 2 pcs" / "Sprei Kecil 4 kg +1 pcs" */
export function describeItem(item: TrackingItem): string {
  const parts = [item.name];
  if (item.weight_kg !== null) parts.push(`${item.weight_kg} kg`);
  if (item.qty_pcs) parts.push(`${item.weight_kg !== null ? "+" : ""}${item.qty_pcs} pcs`);
  return parts.join(" ");
}

export function summarizeItems(items: TrackingItem[]): string {
  return items.map(describeItem).join(", ");
}

/** Input yang diminta kasir untuk satu item katalog. */
export function itemInputs(item: CatalogItem): { weight: boolean; pcs: boolean; pcsLabel: string } {
  if (item.unit === "LOAD_7KG" || item.unit === "KG") return { weight: true, pcs: false, pcsLabel: "" };
  if (item.unit === "LOAD" && item.kg_per_load)
    return { weight: true, pcs: true, pcsLabel: "Tambahan (pcs)" };
  return { weight: false, pcs: true, pcsLabel: "Jumlah (pcs)" };
}

/** Ringkasan aturan harga katalog, mis. "Rp45.000/load 7 kg + Rp10.000/kg (maks 1 kg)". */
export function priceRule(item: CatalogItem): string {
  const price = formatRupiah(item.price);
  const extra = item.extra_price ? formatRupiah(item.extra_price) : null;
  switch (item.unit) {
    case "LOAD_7KG":
      return `${price}/load ${item.kg_per_load ?? 7} kg${
        extra ? ` + ${extra}/kg (maks ${item.max_extra ?? 0} kg)` : ""
      }`;
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

/** "1 hari 3 jam lagi" / "2 jam 15 menit lagi" / "lewat 30 menit" */
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
