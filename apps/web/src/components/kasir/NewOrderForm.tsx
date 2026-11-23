"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import {
  PAYMENT_LABEL,
  cleanPhoneInput,
  formatDateTime,
  formatRupiah,
  paymentLabel,
  phoneError,
  relativeEta,
} from "@/lib/format";
import type { Customer, Order, PaymentMethod, Receipt } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { IconChat, IconCheck, IconPlus, IconPrinter } from "../icons";
import { Modal } from "../overlay";
import {
  Alert,
  Button,
  ButtonLink,
  ErrorText,
  Field,
  PaymentBadge,
  Segmented,
  Switch,
  inputClass,
  textareaClass,
} from "../ui";
import { ItemLines, SpeedField, useItemEditor } from "./ItemEditor";

// Satu pilihan untuk "kapan & bagaimana bayar": bayar nanti, atau langsung lunas dengan metodenya.
type Pay = "later" | PaymentMethod;

const METHODS: PaymentMethod[] = ["CASH", "QRIS", "TRANSFER"];
const QUICK_NOTES = ["Ada noda", "Mudah luntur", "Pisah warna", "Ada yang robek", "Tanpa pewangi"];
const LOOKUP_DELAY_MS = 400;

export function NewOrderForm({ onCreated }: { onCreated: (order: Order) => void }) {
  const editor = useItemEditor();
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  // Bawaan mati: kasir menanyakan dulu apakah nomornya aktif WhatsApp, baru dinyalakan.
  const [whatsapp, setWhatsapp] = useState(false);
  const [name, setName] = useState("");
  const [knownCustomer, setKnownCustomer] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [pay, setPay] = useState<Pay>("later");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const now = useNow();

  const phoneProblem = phoneError(phone, whatsapp);
  const shownPhoneProblem = phoneTouched ? phoneProblem : null;
  const canSubmit = editor.ready && !busy && !phoneProblem && name.trim() !== "";
  const paidNow = pay !== "later";

  // Cari pelanggan lama begitu nomor terlihat lengkap, tanpa menunggu kasir pindah kolom.
  useEffect(() => {
    if (phone.replace(/\D/g, "").length < 10) return;
    const id = setTimeout(() => {
      api<Customer | null>(`/orders/customers/lookup?phone=${encodeURIComponent(phone)}`)
        .then((c) => {
          setKnownCustomer(c ? c.name : null);
          if (c) {
            setName((n) => n || c.name);
            setWhatsapp(c.has_whatsapp);
          }
        })
        .catch(() => {});
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(id);
  }, [phone]);

  function addQuickNote(text: string) {
    setNotes((n) => (n.trim() ? `${n.trim().replace(/[.,]$/, "")}, ${text.toLowerCase()}` : text));
  }

  function reset() {
    setPhone("");
    setPhoneTouched(false);
    setWhatsapp(false);
    setName("");
    setKnownCustomer(null);
    setNotes("");
    setShowNotes(false);
    setPay("later");
    editor.reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPhoneTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>("/orders", {
        method: "POST",
        body: {
          customer_name: name,
          customer_phone: phone,
          customer_has_whatsapp: whatsapp,
          is_express: editor.express,
          items: editor.items,
          notes: notes.trim() || null,
          payment_method: paidNow ? pay : null,
        },
      });
      setReceipt(await api<Receipt>(`/orders/${order.id}/receipt`));
      reset();
      onCreated(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pesanan");
    } finally {
      setBusy(false);
    }
  }

  const total = editor.quote ? formatRupiah(editor.quote.total) : "Rp –";
  const submitLabel = busy ? "Menyimpan..." : paidNow ? `Simpan · lunas ${PAYMENT_LABEL[pay]}` : "Simpan nota";

  return (
    <>
      <form onSubmit={submit} className="rounded-2xl bg-surface shadow-card" aria-label="Pesanan baru">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-ink">Nota baru</h2>
        </header>

        <div className="space-y-5 p-4">
          <fieldset className="space-y-3">
            <legend className="label-caps mb-2">1 · Pelanggan</legend>
            <Field label={whatsapp ? "No. WhatsApp" : "No. HP / telepon"}>
              <input
                className={inputClass}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="08xx xxxx xxxx"
                maxLength={20}
                value={phone}
                aria-invalid={shownPhoneProblem ? true : undefined}
                aria-describedby={shownPhoneProblem ? "phone-error" : undefined}
                onChange={(e) => {
                  setPhone(cleanPhoneInput(e.target.value));
                  setKnownCustomer(null);
                }}
                onBlur={() => setPhoneTouched(phone.trim() !== "")}
                required
              />
            </Field>
            {shownPhoneProblem && (
              <p id="phone-error" className="-mt-1 text-sm text-danger-700">
                {shownPhoneProblem}
              </p>
            )}
            <Switch
              label="Pakai WhatsApp"
              description={
                whatsapp
                  ? "Nota dan kabar siap diambil dikirim lewat WA."
                  : "Nyalakan bila nomornya aktif WA."
              }
              checked={whatsapp}
              onChange={setWhatsapp}
            />
            {knownCustomer && (
              <p className="flex items-center gap-1.5 text-sm text-ok-700" role="status">
                <IconCheck size={14} />
                Pelanggan lama · {knownCustomer}
                {!whatsapp && " · tanpa WhatsApp"}
              </p>
            )}
            <Field label="Nama">
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

          <div>
            <p className="label-caps mb-2" aria-hidden="true">
              2 · Cucian
            </p>
            <div className="space-y-4">
              <ItemLines editor={editor} />
              <SpeedField editor={editor} />
            </div>
          </div>

          <fieldset>
            <legend className="label-caps mb-2">3 · Pembayaran</legend>
            <Segmented<Pay>
              label="Pembayaran"
              value={pay}
              onChange={setPay}
              options={[
                { value: "later", label: "Bayar nanti" },
                ...METHODS.map((m) => ({ value: m, label: PAYMENT_LABEL[m] })),
              ]}
            />
          </fieldset>

          {showNotes ? (
            <fieldset>
              <legend className="label-caps mb-2">Catatan</legend>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {QUICK_NOTES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => addQuickNote(n)}
                    className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line-strong transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-300 pointer-coarse:h-10 pointer-coarse:px-3"
                  >
                    <IconPlus size={12} />
                    {n}
                  </button>
                ))}
              </div>
              <textarea
                className={textareaClass}
                rows={2}
                maxLength={1000}
                placeholder="Mis. noda di kemeja putih"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-label="Catatan pesanan"
                autoFocus
              />
            </fieldset>
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md text-sm font-medium text-brand-600 hover:text-brand-700 pointer-coarse:h-11"
            >
              <IconPlus size={14} />
              Tambah catatan
            </button>
          )}

          <ErrorText message={editor.quoteError} />
          <ErrorText message={error ?? editor.catalogError} />
          {editor.catalog.length === 0 && !editor.catalogError && <Alert tone="info">Memuat daftar layanan...</Alert>}
        </div>

        <footer className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] z-10 rounded-b-2xl bg-surface px-4 py-3 shadow-[inset_0_1px_0_var(--color-line)] lg:bottom-0">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span className="text-xs text-muted">
                Total · {editor.lines.length} item{editor.express ? " · Express" : ""}
              </span>
              <span className="tabular display text-2xl text-ink" aria-live="polite">
                {total}
              </span>
            </span>
            <PaymentBadge paid={paidNow} />
          </div>
          <Button type="submit" size="lg" className="mt-3 w-full" loading={busy} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </footer>
      </form>

      <SavedDialog receipt={receipt} now={now} onClose={() => setReceipt(null)} />
    </>
  );
}

// Setelah simpan: formulir sudah kosong untuk pelanggan berikutnya; kode lacak dan aksi nota muncul di dialog.
function SavedDialog({ receipt, now, onClose }: { receipt: Receipt | null; now: number; onClose: () => void }) {
  const o = receipt?.order;
  const wa = o?.customer.has_whatsapp ?? true;
  return (
    <Modal
      open={receipt !== null}
      onClose={onClose}
      title="Nota tersimpan"
      description={
        wa ? "Masuk antrean · WhatsApp terkirim otomatis" : "Masuk antrean · pelanggan tanpa WhatsApp"
      }
      footer={
        <Button size="lg" className="w-full" onClick={onClose} autoFocus>
          <IconPlus size={16} />
          Nota berikutnya
        </Button>
      }
    >
      {receipt && o && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-4 py-3 ring-1 ring-inset ring-line">
            <div>
              <p className="text-xs text-muted">Kode lacak</p>
              <p className="serial mt-1 text-2xl leading-none tracking-[0.12em]">{o.tracking_code}</p>
            </div>
            <PaymentBadge paid={o.is_paid} className="animate-stamp" />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-base">
            <dt className="text-muted">Pelanggan</dt>
            <dd className="text-right font-medium text-ink">{o.customer.name}</dd>
            <dt className="text-muted">Total</dt>
            <dd className="text-right">
              <span className="tabular font-semibold text-ink">{formatRupiah(o.price_total)}</span>
              <span className="block text-xs text-muted">{paymentLabel(o)}</span>
            </dd>
            <dt className="text-muted">Siap</dt>
            <dd className="text-right">
              <span className="font-medium text-ink">{formatDateTime(o.promised_ready_at)}</span>
              {now > 0 && <span className="block text-xs text-muted">{relativeEta(o.promised_ready_at, now)}</span>}
            </dd>
          </dl>
          {wa ? (
            <div className="grid grid-cols-2 gap-2">
              <ButtonLink variant="secondary" href={receipt.whatsapp_link} target="_blank" rel="noopener noreferrer">
                <IconChat size={16} className="text-ok-600" />
                Kirim ulang WA
              </ButtonLink>
              <ButtonLink variant="secondary" href={`/nota/${o.id}`} target="_blank" rel="noopener">
                <IconPrinter size={16} />
                Cetak nota
              </ButtonLink>
            </div>
          ) : (
            <>
              <Alert tone="info">Cetak nota dan berikan ke pelanggan. Kode lacaknya untuk cek status di web.</Alert>
              <ButtonLink variant="secondary" className="w-full" href={`/nota/${o.id}`} target="_blank" rel="noopener">
                <IconPrinter size={16} />
                Cetak nota
              </ButtonLink>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
