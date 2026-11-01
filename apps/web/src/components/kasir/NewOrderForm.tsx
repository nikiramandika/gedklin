"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { PAYMENT_LABEL, formatDateTime, formatRupiah, paymentLabel, relativeEta } from "@/lib/format";
import type { Customer, Order, PaymentMethod, Receipt } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { IconChat, IconCheck, IconPlus, IconPrinter, IconReceipt } from "../icons";
import {
  Alert,
  Button,
  ButtonLink,
  CardHeader,
  ErrorText,
  Field,
  PaymentBadge,
  Segmented,
  inputClass,
  textareaClass,
} from "../ui";
import { ItemLines, SpeedField, useItemEditor } from "./ItemEditor";

type PayTiming = "later" | "now";

const METHODS: PaymentMethod[] = ["CASH", "QRIS", "TRANSFER"];
// Catatan yang paling sering, supaya kasir cukup mengetuk.
const QUICK_NOTES = ["Ada noda", "Mudah luntur", "Pisah warna", "Ada yang robek", "Tanpa pewangi"];

export function NewOrderForm({ onCreated }: { onCreated: () => void }) {
  const editor = useItemEditor();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [knownCustomer, setKnownCustomer] = useState(false);
  const [notes, setNotes] = useState("");
  const [payTiming, setPayTiming] = useState<PayTiming>("later");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const now = useNow();

  const canSubmit = editor.ready && !busy;

  async function lookupCustomer() {
    if (phone.replace(/\D/g, "").length < 9) return;
    try {
      const c = await api<Customer | null>(`/orders/customers/lookup?phone=${encodeURIComponent(phone)}`);
      setKnownCustomer(c !== null);
      if (c && !name) setName(c.name);
    } catch {
      /* pencarian pelanggan opsional */
    }
  }

  function addQuickNote(text: string) {
    setNotes((n) => (n.trim() ? `${n.trim().replace(/[.,]$/, "")}, ${text.toLowerCase()}` : text));
  }

  function reset() {
    setPhone("");
    setName("");
    setKnownCustomer(false);
    setNotes("");
    setPayTiming("later");
    setMethod("CASH");
    editor.reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>("/orders", {
        method: "POST",
        body: {
          customer_name: name,
          customer_phone: phone,
          is_express: editor.express,
          items: editor.items,
          notes: notes.trim() || null,
          payment_method: payTiming === "now" ? method : null,
        },
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
        <CardHeader icon={IconCheck} tone="ok" title="Pesanan tersimpan" description="Berikan kode ini ke pelanggan." />
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
            <dd className="text-right font-medium text-ink">{o.is_express ? "Express" : "Reguler"}</dd>
            <dt className="text-muted">Total</dt>
            <dd className="text-right">
              <span className="tabular block text-lg font-semibold text-ink">{formatRupiah(o.price_total)}</span>
              <span className="text-xs text-muted">{paymentLabel(o)}</span>
            </dd>
            <dt className="text-muted">Perkiraan siap</dt>
            <dd className="text-right">
              <span className="font-medium text-ink">{formatDateTime(o.predicted_ready_at)}</span>
              <span className="block text-xs text-muted">{relativeEta(o.predicted_ready_at, now)}</span>
            </dd>
          </dl>
          <p className="text-center text-xs text-muted">
            Nota dikirim otomatis ke WhatsApp pelanggan. Status pengiriman ada di detail pesanan.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ButtonLink variant="whatsapp" size="lg" href={receipt.whatsapp_link} target="_blank" rel="noopener noreferrer">
              <IconChat size={18} />
              Kirim ulang WA
            </ButtonLink>
            <ButtonLink variant="secondary" size="lg" href={`/nota/${o.id}`} target="_blank" rel="noopener">
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

  return (
    <form onSubmit={submit} className="rounded-2xl bg-surface shadow-card" aria-label="Pesanan baru">
      <CardHeader icon={IconReceipt} title="Pesanan Baru" description="Harga dihitung otomatis sesuai price list." />

      <div className="space-y-6 px-5 pb-5 pt-3">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold text-ink">Pelanggan</legend>
          <Field label="No. WhatsApp" hint={knownCustomer ? "Pelanggan lama, nama terisi otomatis." : undefined}>
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

        <ItemLines editor={editor} />
        <SpeedField editor={editor} />

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">
            Catatan <span className="font-normal text-muted">(opsional)</span>
          </legend>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => addQuickNote(n)}
                className="inline-flex h-9 items-center gap-1 rounded-full bg-canvas px-3 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700"
              >
                <IconPlus size={14} />
                {n}
              </button>
            ))}
          </div>
          <textarea
            className={textareaClass}
            rows={2}
            maxLength={1000}
            placeholder="Kondisi barang atau permintaan pelanggan, mis. noda di kemeja putih"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Catatan pesanan"
          />
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">Pembayaran</legend>
          <Segmented<PayTiming>
            label="Waktu pembayaran"
            value={payTiming}
            onChange={setPayTiming}
            options={[
              { value: "later", label: "Bayar saat ambil" },
              { value: "now", label: "Lunas sekarang" },
            ]}
          />
          {payTiming === "now" && (
            <div className="mt-2">
              <Segmented<PaymentMethod>
                label="Metode pembayaran"
                value={method}
                onChange={setMethod}
                options={METHODS.map((m) => ({ value: m, label: PAYMENT_LABEL[m] }))}
              />
            </div>
          )}
        </fieldset>

        <ErrorText message={editor.quoteError} />
        <ErrorText message={error ?? editor.catalogError} />
        {editor.catalog.length === 0 && !editor.catalogError && <Alert tone="info">Memuat daftar layanan...</Alert>}
      </div>

      <footer className="sticky bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 rounded-b-2xl bg-surface/95 px-5 py-4 shadow-[0_-8px_16px_-12px_rgb(16_24_40/0.18)] backdrop-blur lg:bottom-0">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            Total · {editor.lines.length} item{editor.express ? " · Express" : ""}
            <PaymentBadge paid={payTiming === "now"} />
          </span>
          <span className="tabular text-2xl font-semibold tracking-tight text-ink" aria-live="polite">
            {editor.quote ? formatRupiah(editor.quote.total) : "Rp –"}
          </span>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!canSubmit}>
          {busy ? "Menyimpan..." : payTiming === "now" ? `Simpan & terima ${PAYMENT_LABEL[method]}` : "Simpan pesanan"}
        </Button>
      </footer>
    </form>
  );
}
