// Urutan sama dengan API: 0 = Senin ... 6 = Minggu.
export const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
export const WEEKDAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

export const hhmm = (t: string) => t.slice(0, 5);

function dayNames(days: number[]): string {
  const sorted = [...days].sort();
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length > 2 && contiguous) return `${WEEKDAY_NAMES[sorted[0]]}–${WEEKDAY_NAMES[sorted.at(-1)!]}`;
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

export function describeWeek(closed: number[]): string {
  if (closed.length === 0) return "Buka setiap hari.";
  const open = WEEKDAYS.map((_, d) => d).filter((d) => !closed.includes(d));
  return `Buka ${dayNames(open)}, tutup ${dayNames(closed)}.`;
}
