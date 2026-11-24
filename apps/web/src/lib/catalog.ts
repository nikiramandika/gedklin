import type { CatalogGroup, CatalogItem, CatalogUnit, Process } from "./types";

const KILOAN_PROCESSES: Process[] = ["C", "CK", "CKL", "CKS"];

// Sama dengan app/services/catalog.py (divalidasi ulang di server).
export const GROUP_RULES: Record<CatalogGroup, { processes: Process[]; units: CatalogUnit[] }> = {
  KILOAN: { processes: KILOAN_PROCESSES, units: ["KILOAN_7KG"] },
  SETRIKA: { processes: ["S"], units: ["KG"] },
  KHUSUS: { processes: KILOAN_PROCESSES, units: ["PCS", "KG", "LOAD"] },
  SATUAN: { processes: ["SATUAN"], units: ["PCS"] },
  DRY_CLEAN: { processes: ["DRY_CLEAN"], units: ["PCS"] },
};

export const UNIT_LABEL: Record<CatalogUnit, string> = {
  KILOAN_7KG: "Kiloan (berat dasar + per kg)",
  KG: "Per kg",
  PCS: "Per pcs",
  LOAD: "Per load",
};

export const PRICE_LABEL: Record<CatalogUnit, string> = {
  KILOAN_7KG: "Harga berat dasar",
  KG: "Harga per kg",
  PCS: "Harga per pcs",
  LOAD: "Harga per load",
};

export function codeFromName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Satuan untuk "lama kerja per ...", sama dengan ItemWork di app/services/queue.py.
export const WORK_UNIT: Record<CatalogUnit, string> = {
  KILOAN_7KG: "kg",
  KG: "kg",
  PCS: "pcs",
  LOAD: "load",
};

// Kiloan dan per load dihitung dari muatan mesin, setrika per kg dari tarif setrika. Selain itu
// (per pcs, per kg non-setrika) tidak menghasilkan load, jadi tanpa lama kerja sendiri terhitung
// hampir 0 jam dan pesanannya salah tempat di antrean.
export function autoWorkTime(item: Pick<CatalogItem, "unit" | "process">): boolean {
  return item.unit === "KILOAN_7KG" || item.unit === "LOAD" || (item.unit === "KG" && item.process === "S");
}

export function needsWorkTime(item: Pick<CatalogItem, "unit" | "process" | "work_minutes">): boolean {
  return item.work_minutes === null && !autoWorkTime(item);
}

export function workMinutesLabel(item: Pick<CatalogItem, "unit" | "work_minutes">): string | null {
  if (item.work_minutes === null) return null;
  return `${item.work_minutes.toLocaleString("id-ID", { maximumFractionDigits: 1 })} mnt/${WORK_UNIT[item.unit]}`;
}
