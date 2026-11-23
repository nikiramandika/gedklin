import { etaState } from "./format";
import type { OrderStatus } from "./types";

// Sisa waktu (jam kerja) sampai janji di bawah angka ini membuat pesanan ditandai "Segera".
export const PRIORITY_SLACK_HOURS = 4;

// Hasil penjadwalan antrean (Least Slack Time) untuk pesanan yang belum dikerjakan. Slack negatif
// (waktu sudah tidak cukup) juga "Segera"; yang sudah lewat janji tampil sebagai "Terlambat".
export function isUrgent(
  o: {
    status: OrderStatus;
    slack_hours?: number | null;
    promised_ready_at: string | null;
    ready_at?: string | null;
  },
  now: number,
): boolean {
  if (o.status !== "RECEIVED" || o.slack_hours === null || o.slack_hours === undefined) return false;
  if (etaState({ promised_ready_at: o.promised_ready_at, ready_at: o.ready_at ?? null }, now) === "late") return false;
  return o.slack_hours <= PRIORITY_SLACK_HOURS;
}

export function workDuration(hours: number): string {
  return `±${hours.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;
}
