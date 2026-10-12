"use client";

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

import { IconBolt, IconChat, IconCheck, IconPlus, IconPrinter, IconReceipt, IconTrash } from "../icons";
import {
  Alert,
  Button,
  ButtonLink,
  CardHeader,
  ErrorText,
  Field,
  IconButton,
  Segmented,
  Select,
  Stepper,
  inputClass,
} from "../ui";

interface Line {
  key: number;
  code: string;
  weight: string;
  pcs: string;
}

type Speed = "regular" | "express";

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
  const [knownCustomer, setKnownCustomer] = useState(false);
  const [speed, setSpeed] = useState<Speed>("regular");
  const [lines, setLines] = useState<Line[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const now = useNow();
  const express = speed === "express";

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
      const item = byCode.get(lines[idx].code);
      if (!item) return false;
      const inputs = itemInputs(item);
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
  const canSubmit = complete && shownQuote !== null && quoteError === null && !busy;

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function lookupCustomer() {
    if (phone.replace(/\D/g, "").length < 9) return;
    try {
      const c = await api<Customer | null>(
        `/orders/customers/lookup?phone=${encodeURIComponent(phone)}`,
      );
      setKnownCustomer(c !== null);
      if (c && !name) setName(c.name);
    } catch {
      /* pencarian pelanggan opsional */
    }
  }

  function reset() {
    setPhone("");
    setName("");
    setKnownCustomer(false);
    setSpeed("regular");
    setLines(byCode.has(DEFAULT_CODE) ? [newLine(DEFAULT_CODE)] : []);
    setQuote(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>("/orders", {
        method: "POST",
        body: { customer_name: name, customer_phone: phone, is_express: express, items },
      });
      setReceipt(await api<Receipt>(`/orders/${order.id}/receipt`));
      reset();
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
      <section className="rounded-2xl bg-surface shadow-card animate-[enter-up_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <CardHeader
          icon={IconCheck}
          tone="ok"
          title="Pesanan tersimpan"
          description="Berikan kode ini ke pelanggan."
        />
        <div className="space-y-5 p-5">
          <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-6 text-center text-white shadow-raise">
            <p className="text-xs font-medium text-brand-100">Kode lacak</p>
            <p className="mt-2 font-mono text-[26px] font-semibold leading-none tracking-[0.14em] sm:text-[32px]">
              {o.tracking_code}
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
            <dt className="text-muted">Pelanggan</dt>
            <dd className="text-right font-medium text-ink">{o.customer.name}</dd>
            <dt className="text-muted">Layanan</dt>
            <dd className="text-right font-medium text-ink">
              {o.is_express ? "Express" : "Reguler"}
            </dd>
            <dt className="text-muted">Total</dt>
            <dd className="tabular text-right text-lg font-semibold text-ink">
              {formatRupiah(o.price_total)}
            </dd>
            <dt className="text-muted">Perkiraan siap</dt>
            <dd className="text-right">
              <span className="font-medium text-ink">{formatDateTime(o.predicted_ready_at)}</span>
              <span className="block text-xs text-muted">
                {relativeEta(o.predicted_ready_at, now)}
              </span>
            </dd>
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <ButtonLink
              variant="whatsapp"
              size="lg"
              href={receipt.whatsapp_link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconChat size={18} />
              Kirim WA
            </ButtonLink>
            <ButtonLink
              variant="secondary"
              size="lg"
              href={`/nota/${o.id}`}
              target="_blank"
              rel="noopener"
            >
              <IconPrinter size={18} />
              Cetak Nota
            </ButtonLink>
          </div>
          <Button variant="ghost" className="w-full" onClick={() => setReceipt(null)}>
            <IconPlus size={18} />
            Buat pesanan baru
          </Button>
        </div>
      </section>
    );
  }

  const itemCount = lines.length;

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl bg-surface shadow-card"
      aria-label="Pesanan baru"
    >
      <CardHeader
        icon={IconReceipt}
        title="Pesanan Baru"
        description="Harga dihitung otomatis sesuai price list."
      />

      <div className="space-y-6 px-5 pb-5 pt-3">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold text-ink">
            Pelanggan
          </legend>
          <Field
            label="No. WhatsApp"
            hint={knownCustomer ? "Pelanggan lama, nama terisi otomatis." : undefined}
          >
            <input
              className={inputClass}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="08xx xxxx xxxx"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setKnownCustomer(false);
              }}
              onBlur={lookupCustomer}
              required
            />
          </Field>
          <Field label="Nama pelanggan">
            <input
              className={inputClass}
              autoComplete="off"
              autoCapitalize="words"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">
            Item cucian
          </legend>
          <ul className="space-y-3">
            {lines.map((line, idx) => {
              const item = byCode.get(line.code);
              const inputs = item
                ? itemInputs(item)
                : { weight: false, pcs: false, pcsLabel: "" };
              const priced = shownQuote?.items[idx];
              return (
                <li key={line.key} className="rounded-xl bg-tint p-3 ring-1 ring-inset ring-brand-100/60">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Select
                        value={line.code}
                        onChange={(e) =>
                          updateLine(line.key, { code: e.target.value, weight: "", pcs: "" })
                        }
                        aria-label={`Layanan item ${idx + 1}`}
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
                      </Select>
                      {item && <p className="mt-1.5 text-xs text-muted">{priceRule(item)}</p>}
                    </div>
                    <IconButton
                      label={`Hapus item ${idx + 1}`}
                      icon={IconTrash}
                      size={18}
                      disabled={lines.length === 1}
                      className="hover:text-danger-600"
                      onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
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
                            onChange={(e) => updateLine(line.key, { weight: e.target.value })}
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
                          onChange={(v) => updateLine(line.key, { pcs: v })}
                        />
                      </Field>
                    )}
                    <div className="ml-auto pb-2.5 text-right">
                      <p className="tabular text-[15px] font-semibold text-ink">
                        {priced ? formatRupiah(priced.subtotal) : "–"}
                      </p>
                      {priced?.loads != null && (
                        <p className="text-xs text-muted">
                          {priced.loads} load
                          {priced.extra_kg ? ` + ${priced.extra_kg} kg` : ""}
                          {priced.extra_pcs ? ` + ${priced.extra_pcs} pcs` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={catalog.length === 0}
            onClick={() => setLines((ls) => [...ls, newLine(catalog[0].code)])}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-50 text-sm font-semibold text-brand-700 transition-colors duration-150 hover:bg-brand-100 disabled:bg-canvas disabled:text-faint"
          >
            <IconPlus size={18} />
            Tambah item
          </button>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">
            Kecepatan
          </legend>
          <Segmented<Speed>
            label="Kecepatan layanan"
            size="lg"
            value={speed}
            onChange={setSpeed}
            options={[
              { value: "regular", label: "Reguler" },
              {
                value: "express",
                tone: "warn",
                label: (
                  <>
                    <IconBolt size={16} className={express ? "fill-current" : ""} />
                    Express
                    {shownQuote && (
                      <span className="text-xs font-normal opacity-80">
                        ×{shownQuote.express_multiplier}
                      </span>
                    )}
                  </>
                ),
              },
            ]}
          />
          {express && (
            <p className="mt-2 text-xs text-muted">
              Diproses lebih dulu di antrean. Semua item ikut harga Express.
            </p>
          )}
        </fieldset>

        <ErrorText message={complete ? quoteError : null} />
        <ErrorText message={error} />
        {catalog.length === 0 && !error && (
          <Alert tone="info">Memuat daftar layanan...</Alert>
        )}
      </div>

      <footer className="sticky bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 rounded-b-2xl bg-surface/95 shadow-[0_-8px_16px_-12px_rgb(16_24_40/0.18)] px-5 py-4 backdrop-blur lg:bottom-0">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted">
            Total · {itemCount} item{express ? " · Express" : ""}
          </span>
          <span className="tabular text-2xl font-semibold tracking-tight text-ink" aria-live="polite">
            {shownQuote ? formatRupiah(shownQuote.total) : "Rp –"}
          </span>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!canSubmit}>
          {busy ? "Menyimpan..." : "Simpan pesanan"}
        </Button>
      </footer>
    </form>
  );
}
