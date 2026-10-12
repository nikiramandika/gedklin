"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import {
  GROUP_LABEL,
  formatDateTime,
  formatRupiah,
  itemInputs,
  priceRule,
  relativeEta,
} from "@/lib/format";
import type {
  CatalogGroup,
  CatalogItem,
  Customer,
  Order,
  OrderItemInput,
  Quote,
  Receipt,
} from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { Button, Card, ErrorText, Field, inputClass } from "../ui";

interface Line {
  key: number;
  code: string;
  weight: string;
  pcs: string;
}

const GROUPS: CatalogGroup[] = ["KILOAN", "SETRIKA", "KHUSUS", "SATUAN"];
const DEFAULT_CODE = "CKS";
const QUOTE_DELAY_MS = 300;

let nextKey = 1;
function newLine(code: string): Line {
  return { key: nextKey++, code, weight: "", pcs: "" };
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

export function NewOrderForm({ onCreated }: { onCreated: () => void }) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [express, setExpress] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const now = useNow();

  useEffect(() => {
    api<CatalogItem[]>("/catalog")
      .then((items) => {
        setCatalog(items);
        const first = items.find((i) => i.code === DEFAULT_CODE) ?? items[0];
        if (first) setLines((ls) => (ls.length ? ls : [newLine(first.code)]));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const byCode = useMemo(() => new Map(catalog.map((c) => [c.code, c])), [catalog]);
  const items = useMemo(
    () => lines.map((l) => toInput(l, byCode.get(l.code))),
    [lines, byCode],
  );
  const complete =
    items.length > 0 &&
    items.every((i, idx) => {
      const inputs = itemInputs(byCode.get(lines[idx].code)!);
      return (!inputs.weight || (i.weight_kg ?? 0) > 0) && (!inputs.pcs || i.qty_pcs !== null);
    });

  // Harga dihitung server (services/pricing.py), jadi aturan harga tidak diduplikasi di sini.
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

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function lookupCustomer() {
    if (phone.replace(/\D/g, "").length < 9) return;
    try {
      const c = await api<Customer | null>(
        `/orders/customers/lookup?phone=${encodeURIComponent(phone)}`,
      );
      if (c && !name) setName(c.name);
    } catch {
      /* pencarian pelanggan opsional */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>("/orders", {
        method: "POST",
        body: { customer_name: name, customer_phone: phone, is_express: express, items },
      });
      setReceipt(await api<Receipt>(`/orders/${order.id}/receipt`));
      setPhone("");
      setName("");
      setExpress(false);
      setLines(byCode.has(DEFAULT_CODE) ? [newLine(DEFAULT_CODE)] : []);
      setQuote(null);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pesanan");
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    const o = receipt.order;
    return (
      <Card title="Pesanan tersimpan">
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-teal-50 p-3 text-center">
            <p className="text-xs text-teal-700">Kode lacak</p>
            <p className="font-mono text-2xl font-bold tracking-widest text-teal-900">
              {o.tracking_code}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-slate-500">Pelanggan</dt>
            <dd>{o.customer.name}</dd>
            <dt className="text-slate-500">Total</dt>
            <dd className="font-semibold">{formatRupiah(o.price_total)}</dd>
            <dt className="text-slate-500">Perkiraan siap</dt>
            <dd>
              {formatDateTime(o.predicted_ready_at)}
              <span className="block text-xs text-slate-500">
                {relativeEta(o.predicted_ready_at, now)}
              </span>
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <a href={receipt.whatsapp_link} target="_blank" rel="noopener noreferrer">
              <Button type="button">Kirim Nota via WA</Button>
            </a>
            <Link href={`/nota/${o.id}`} target="_blank">
              <Button type="button" variant="secondary">
                Cetak Nota
              </Button>
            </Link>
            <Button type="button" variant="ghost" onClick={() => setReceipt(null)}>
              Pesanan baru
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Pesanan Baru">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="No. WhatsApp">
          <input
            className={inputClass}
            inputMode="tel"
            placeholder="08xxxxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={lookupCustomer}
            required
          />
        </Field>
        <Field label="Nama Pelanggan">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-600">Item</span>
          {lines.map((line, idx) => {
            const item = byCode.get(line.code);
            const inputs = item ? itemInputs(item) : { weight: false, pcs: false, pcsLabel: "" };
            const priced = shownQuote?.items[idx];
            return (
              <div key={line.key} className="space-y-2 rounded-lg border border-slate-200 p-2">
                <div className="flex gap-2">
                  <select
                    className={inputClass}
                    value={line.code}
                    onChange={(e) =>
                      updateLine(line.key, { code: e.target.value, weight: "", pcs: "" })
                    }
                    aria-label="Layanan"
                  >
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
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Hapus item"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  >
                    ✕
                  </Button>
                </div>
                {item && <p className="text-xs text-slate-500">{priceRule(item)}</p>}
                <div className="flex items-end gap-2">
                  {inputs.weight && (
                    <Field label="Berat (kg)">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        placeholder="5,5"
                        value={line.weight}
                        onChange={(e) => updateLine(line.key, { weight: e.target.value })}
                        required
                      />
                    </Field>
                  )}
                  {inputs.pcs && (
                    <Field label={inputs.pcsLabel}>
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        placeholder={inputs.weight ? "0" : "1"}
                        value={line.pcs}
                        onChange={(e) => updateLine(line.key, { pcs: e.target.value })}
                        required={!inputs.weight}
                      />
                    </Field>
                  )}
                  <span className="ml-auto whitespace-nowrap pb-2 text-sm font-medium">
                    {priced ? formatRupiah(priced.subtotal) : "-"}
                  </span>
                </div>
                {priced?.loads != null && (
                  <p className="text-xs text-slate-500">
                    {priced.loads} load
                    {priced.extra_kg ? ` + ${priced.extra_kg} kg` : ""}
                    {priced.extra_pcs ? ` + ${priced.extra_pcs} pcs` : ""}
                  </p>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={catalog.length === 0}
            onClick={() => setLines((ls) => [...ls, newLine(catalog[0].code)])}
          >
            + Tambah item
          </Button>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-rose-600"
            checked={express}
            onChange={(e) => setExpress(e.target.checked)}
          />
          Express (diproses lebih dulu
          {shownQuote ? `, harga ×${shownQuote.express_multiplier}` : ""})
        </label>
        <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">Total</span>
          <span className="text-lg font-semibold">
            {shownQuote ? formatRupiah(shownQuote.total) : "-"}
          </span>
        </div>
        <ErrorText message={complete ? quoteError : null} />
        <ErrorText message={error} />
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !complete || !shownQuote || quoteError !== null}
        >
          {busy ? "Menyimpan..." : "Simpan & Hitung Perkiraan"}
        </Button>
      </form>
    </Card>
  );
}
