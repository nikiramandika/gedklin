"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { GROUP_LABEL, formatRupiah, itemInputs, lineDetail, priceRule } from "@/lib/format";
import type { CatalogGroup, CatalogItem, OrderItem, OrderItemInput, Quote } from "@/lib/types";

import { IconBolt, IconPlus, IconTrash } from "../icons";
import { Field, IconButton, Segmented, Select, Stepper, inputClass } from "../ui";

interface Line {
  key: number;
  code: string;
  weight: string;
  pcs: string;
}

export type Speed = "regular" | "express";

const GROUPS: CatalogGroup[] = ["KILOAN", "SETRIKA", "KHUSUS", "SATUAN", "DRY_CLEAN"];
const DEFAULT_CODE = "CKS";
const QUOTE_DELAY_MS = 300;

let nextKey = 1;
function newLine(code: string, weight = "", pcs = ""): Line {
  return { key: nextKey++, code, weight, pcs };
}

function parseNumber(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

function toInput(line: Line, item: CatalogItem | undefined): OrderItemInput {
  const inputs = item ? itemInputs(item) : { weight: false, pcs: false };
  return {
    catalog_code: line.code,
    weight_kg: inputs.weight ? parseNumber(line.weight) : null,
    qty_pcs: inputs.pcs ? parseNumber(line.pcs) : null,
  };
}

function linesFrom(items: OrderItem[]): Line[] {
  return items.map((i) =>
    newLine(
      i.catalog_code,
      i.weight_kg === null ? "" : String(i.weight_kg).replace(".", ","),
      i.qty_pcs === null ? "" : String(i.qty_pcs),
    ),
  );
}

export function useItemEditor(initial?: { items: OrderItem[]; isExpress: boolean }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() => (initial ? linesFrom(initial.items) : []));
  const [speed, setSpeed] = useState<Speed>(initial?.isExpress ? "express" : "regular");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    api<CatalogItem[]>("/catalog")
      .then((items) => {
        setCatalog(items);
        const first = items.find((i) => i.code === DEFAULT_CODE) ?? items[0];
        if (first) setLines((ls) => (ls.length ? ls : [newLine(first.code)]));
      })
      .catch((e: Error) => setCatalogError(e.message));
  }, []);

  const byCode = useMemo(() => new Map(catalog.map((c) => [c.code, c])), [catalog]);
  const expressAvailable = lines.some((l) => byCode.get(l.code)?.express_eligible);
  const express = speed === "express" && expressAvailable;
  const expressNames = catalog
    .filter((c) => c.express_eligible)
    .map((c) => c.name)
    .join(" atau ");
  const items = useMemo(() => lines.map((l) => toInput(l, byCode.get(l.code))), [lines, byCode]);
  const complete =
    items.length > 0 &&
    items.every((i, idx) => {
      const item = byCode.get(lines[idx].code);
      if (!item) return false;
      const inputs = itemInputs(item);
      return (!inputs.weight || (i.weight_kg ?? 0) > 0) && (!inputs.pcs || i.qty_pcs !== null);
    });
  const unavailable = catalog.length > 0 && lines.some((l) => !byCode.has(l.code));

  useEffect(() => {
    if (!complete) return;
    const id = setTimeout(() => {
      api<Quote>("/orders/quote", { method: "POST", body: { is_express: express, items } })
        .then((q) => {
          setQuote(q);
          setQuoteError(null);
        })
        .catch((e: Error) => {
          setQuote(null);
          setQuoteError(e.message);
        });
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(id);
  }, [complete, express, items]);

  const shownQuote = complete ? quote : null;

  return {
    catalog,
    catalogError,
    byCode,
    lines,
    speed,
    setSpeed,
    express,
    expressAvailable,
    expressNames,
    items,
    complete,
    unavailable,
    quote: shownQuote,
    quoteError: complete ? quoteError : null,
    ready: complete && shownQuote !== null && quoteError === null,
    updateLine(key: number, patch: Partial<Line>) {
      setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    },
    removeLine(key: number) {
      setLines((ls) => ls.filter((l) => l.key !== key));
    },
    addLine() {
      if (catalog.length) setLines((ls) => [...ls, newLine(catalog[0].code)]);
    },
    reset() {
      setSpeed("regular");
      setLines(byCode.has(DEFAULT_CODE) ? [newLine(DEFAULT_CODE)] : []);
      setQuote(null);
    },
  };
}

export type ItemEditor = ReturnType<typeof useItemEditor>;

export function ItemLines({ editor }: { editor: ItemEditor }) {
  const { lines, byCode, catalog, quote } = editor;
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold text-ink">Item cucian</legend>
      <ul className="space-y-3">
        {lines.map((line, idx) => {
          const item = byCode.get(line.code);
          const inputs = item ? itemInputs(item) : { weight: false, pcs: false, pcsLabel: "" };
          const priced = quote?.items[idx];
          return (
            <li key={line.key} className="rounded-xl bg-tint p-3 ring-1 ring-inset ring-brand-100/60">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    value={item ? line.code : ""}
                    onChange={(e) => editor.updateLine(line.key, { code: e.target.value, weight: "", pcs: "" })}
                    aria-label={`Layanan item ${idx + 1}`}
                  >
                    {!item && <option value="">Layanan {line.code} tidak aktif, pilih lagi</option>}
                    {GROUPS.map((g) => (
                      <optgroup key={g} label={GROUP_LABEL[g]}>
                        {catalog
                          .filter((c) => c.group === g)
                          .map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                  {item && <p className="mt-1.5 text-xs text-muted">{priceRule(item)}</p>}
                </div>
                <IconButton
                  label={`Hapus item ${idx + 1}`}
                  icon={IconTrash}
                  size={18}
                  disabled={lines.length === 1}
                  className="hover:text-danger-600"
                  onClick={() => editor.removeLine(line.key)}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {inputs.weight && (
                  <Field label="Berat" className="w-32">
                    <div className="relative">
                      <input
                        className={`${inputClass} tabular pr-10`}
                        inputMode="decimal"
                        placeholder="0,0"
                        value={line.weight}
                        onChange={(e) => editor.updateLine(line.key, { weight: e.target.value })}
                        required
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
                        kg
                      </span>
                    </div>
                  </Field>
                )}
                {inputs.pcs && (
                  <Field label={inputs.pcsLabel} className="w-36">
                    <Stepper
                      label={inputs.pcsLabel.toLowerCase()}
                      value={line.pcs}
                      placeholder={inputs.weight ? "0" : "1"}
                      onChange={(v) => editor.updateLine(line.key, { pcs: v })}
                    />
                  </Field>
                )}
                <div className="ml-auto pb-2.5 text-right">
                  <p className="tabular text-[15px] font-semibold text-ink">
                    {priced ? formatRupiah(priced.subtotal) : "–"}
                  </p>
                  {priced && lineDetail(priced) && <p className="text-xs text-muted">{lineDetail(priced)}</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={catalog.length === 0}
        onClick={editor.addLine}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-50 text-sm font-semibold text-brand-700 transition-colors duration-150 hover:bg-brand-100 disabled:bg-canvas disabled:text-faint"
      >
        <IconPlus size={18} />
        Tambah item
      </button>
    </fieldset>
  );
}

export function SpeedField({ editor }: { editor: ItemEditor }) {
  const { express, expressAvailable, expressNames, quote } = editor;
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold text-ink">Kecepatan</legend>
      <Segmented<Speed>
        label="Kecepatan layanan"
        size="lg"
        value={express ? "express" : "regular"}
        onChange={editor.setSpeed}
        options={[
          { value: "regular", label: "Reguler" },
          {
            value: "express",
            tone: "warn",
            disabled: !expressAvailable,
            label: (
              <>
                <IconBolt size={16} className={express ? "fill-current" : ""} />
                Express
                {quote && expressAvailable && (
                  <span className="text-xs font-normal opacity-80">×{quote.express_multiplier}</span>
                )}
              </>
            ),
          },
        ]}
      />
      {express ? (
        <p className="mt-2 text-xs text-muted">
          Diproses lebih dulu di antrean. Hanya item {expressNames} yang ikut harga Express.
        </p>
      ) : (
        !expressAvailable &&
        expressNames && <p className="mt-2 text-xs text-muted">Express hanya tersedia untuk {expressNames}.</p>
      )}
    </fieldset>
  );
}
