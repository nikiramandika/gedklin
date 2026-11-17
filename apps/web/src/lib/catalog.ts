import type { CatalogGroup, CatalogUnit, Process } from "./types";

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
