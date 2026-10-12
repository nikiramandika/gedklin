"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { SERVICE_LABEL, formatDateTime, formatRupiah, relativeEta } from "@/lib/format";
import type { Customer, Order, Receipt, Service, ServiceType } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { Button, Card, ErrorText, Field, inputClass } from "../ui";

const EMPTY = { phone: "", name: "", service: "CKS" as ServiceType, express: false, weight: "" };

export function NewOrderForm({ onCreated }: { onCreated: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const now = useNow();

  useEffect(() => {
    api<Service[]>("/services")
      .then(setServices)
      .catch((e: Error) => setError(e.message));
  }, []);

  const service = services.find((s) => s.code === form.service);
  const pricePerKg = service
    ? Number(form.express ? service.price_per_kg_express : service.price_per_kg_regular)
    : 0;
  const weight = Number(form.weight.replace(",", "."));
  const total = weight > 0 ? Math.round(weight * pricePerKg) : 0;

  async function lookupCustomer() {
    if (form.phone.replace(/\D/g, "").length < 9) return;
    try {
      const c = await api<Customer | null>(
        `/orders/customers/lookup?phone=${encodeURIComponent(form.phone)}`,
      );
      if (c && !form.name) setForm((f) => ({ ...f, name: c.name }));
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
        body: {
          customer_name: form.name,
          customer_phone: form.phone,
          service_type: form.service,
          is_express: form.express,
          weight_kg: weight,
        },
      });
      setReceipt(await api<Receipt>(`/orders/${order.id}/receipt`));
      setForm(EMPTY);
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
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            onBlur={lookupCustomer}
            required
          />
        </Field>
        <Field label="Nama Pelanggan">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Layanan">
          <div className="grid grid-cols-2 gap-2">
            {(["CK", "CKS"] as ServiceType[]).map((code) => (
              <button
                type="button"
                key={code}
                onClick={() => setForm({ ...form, service: code })}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  form.service === code
                    ? "border-teal-500 bg-teal-50 text-teal-900"
                    : "border-slate-300 text-slate-700"
                }`}
              >
                <span className="font-semibold">{code}</span>
                <span className="block text-xs text-slate-500">{SERVICE_LABEL[code]}</span>
              </button>
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-rose-600"
            checked={form.express}
            onChange={(e) => setForm({ ...form, express: e.target.checked })}
          />
          Express (diproses lebih dulu)
        </label>
        <Field label="Berat (kg)">
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="3,5"
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
            required
          />
        </Field>
        <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">
            {pricePerKg ? `${formatRupiah(pricePerKg)}/kg` : "-"}
          </span>
          <span className="text-lg font-semibold">{formatRupiah(total)}</span>
        </div>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy || !(weight > 0)}>
          {busy ? "Menyimpan..." : "Simpan & Hitung Perkiraan"}
        </Button>
      </form>
    </Card>
  );
}
