"use client";

import { useState } from "react";

import { Button, Field, Segmented, cardClass, inputClass } from "@/components/ui";
import { useNow } from "@/lib/useNow";

const TZ = "Asia/Jakarta";

export type Preset = "today" | "7d" | "30d" | "month" | "last-month" | "custom";
export const PRESETS: Preset[] = ["today", "7d", "30d", "month", "last-month", "custom"];

export function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function localISO(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
}

function presetRange(preset: Exclude<Preset, "custom">, today: string): [string, string] {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "today":
      return [today, today];
    case "7d":
      return [shift(today, -6), today];
    case "30d":
      return [shift(today, -29), today];
    case "month":
      return [monthStart, today];
    case "last-month": {
      const lastEnd = shift(monthStart, -1);
      return [`${lastEnd.slice(0, 8)}01`, lastEnd];
    }
  }
}

export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, ...opts }).format(new Date(`${iso}T12:00:00+07:00`));
}

export function periodLabel(start: string, end: string): string {
  if (start === end) return formatDay(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  return `${formatDay(start, opts)} – ${formatDay(end, opts)}`;
}

export interface Period {
  preset: Preset;
  custom: [string, string] | null;
  today: string | null;
  range: [string, string] | null;
  choose: (p: Preset) => void;
  setCustom: (r: [string, string]) => void;
}

export function usePeriod(initial: { preset?: Preset; custom?: [string, string] | null } = {}): Period {
  // Tanggal "hari ini" baru diketahui di browser (0 saat prerender di server).
  const now = useNow();
  const today = now ? localISO(now) : null;
  const [preset, setPreset] = useState<Preset>(initial.preset ?? "7d");
  const [custom, setCustom] = useState<[string, string] | null>(initial.custom ?? null);

  const range: [string, string] | null =
    preset === "custom" ? custom : today ? presetRange(preset, today) : null;

  function choose(p: Preset) {
    if (p === "custom" && !custom && range) setCustom(range);
    setPreset(p);
  }

  return { preset, custom, today, range, choose, setCustom };
}

export function PeriodPicker({ period, label = "Periode laporan" }: { period: Period; label?: string }) {
  const { preset, custom, today, range, choose, setCustom } = period;
  return (
    <div className={`${cardClass} space-y-3 p-3 sm:p-4`}>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <Segmented<Preset>
            label={label}
            value={preset}
            onChange={choose}
            options={[
              { value: "today", label: "Hari ini" },
              { value: "7d", label: "7 hari" },
              { value: "30d", label: "30 hari" },
              { value: "month", label: "Bulan ini" },
              { value: "last-month", label: "Bulan lalu" },
              { value: "custom", label: "Pilih tanggal" },
            ]}
          />
        </div>
      </div>
      {preset === "custom" && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const start = String(data.get("start"));
            const end = String(data.get("end"));
            if (start && end) setCustom(start <= end ? [start, end] : [end, start]);
          }}
        >
          <Field label="Dari" className="w-44">
            <input className={inputClass} type="date" name="start" defaultValue={custom?.[0]} max={today ?? undefined} required />
          </Field>
          <Field label="Sampai" className="w-44">
            <input className={inputClass} type="date" name="end" defaultValue={custom?.[1]} max={today ?? undefined} required />
          </Field>
          <Button type="submit">Tampilkan</Button>
        </form>
      )}
      <p className="px-1 text-sm text-muted">
        Periode: <span className="font-medium text-ink">{range ? periodLabel(range[0], range[1]) : "–"}</span>
      </p>
    </div>
  );
}
