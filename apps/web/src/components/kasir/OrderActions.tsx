"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { PAYMENT_LABEL, formatRupiah } from "@/lib/format";
import type { Order, PaymentMethod } from "@/lib/types";

import { Modal } from "../overlay";
import { Button, ErrorText, Field, PaymentBadge, Segmented, inputClass } from "../ui";

export type OrderDialog = { kind: "ready" | "pickup" | "payment"; order: Order } | null;

const METHODS: PaymentMethod[] = ["CASH", "QRIS", "TRANSFER"];
const FORM_ID = "order-action-form";

function Summary({ order }: { order: Order }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-y border-dashed border-field/60 py-3">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-ink">{order.customer.name}</p>
        <p className="serial text-sm">{order.tracking_code}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <p className="tabular text-lg font-semibold text-ink">{formatRupiah(order.price_total)}</p>
        <PaymentBadge paid={order.is_paid} />
      </div>
    </div>
  );
}

function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <Field label="Metode pembayaran">
      <Segmented<PaymentMethod>
        label="Metode pembayaran"
        size="lg"
        value={value}
        onChange={onChange}
        options={METHODS.map((m) => ({ value: m, label: PAYMENT_LABEL[m] }))}
      />
    </Field>
  );
}

export function OrderActionDialog({
  dialog,
  onClose,
  onDone,
}: {
  dialog: OrderDialog;
  onClose: () => void;
  onDone: (order: Order, message: string) => void;
}) {
  // Dipasang ulang per pesanan/aksi supaya isian sebelumnya tidak terbawa.
  const key = dialog ? `${dialog.kind}-${dialog.order.id}` : "closed";
  return <ActionModal key={key} dialog={dialog} onClose={onClose} onDone={onDone} />;
}

function ActionModal({
  dialog,
  onClose,
  onDone,
}: {
  dialog: OrderDialog;
  onClose: () => void;
  onDone: (order: Order, message: string) => void;
}) {
  const [rack, setRack] = useState(dialog?.order.rack_location ?? "");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const order = dialog?.order;
  const needsPayment = dialog?.kind === "payment" || (dialog?.kind === "pickup" && !order?.is_paid);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog || !order) return;
    setBusy(true);
    setError(null);
    try {
      let updated: Order;
      let message: string;
      if (dialog.kind === "ready") {
        updated = await api<Order>(`/orders/${order.id}/status`, {
          method: "POST",
          body: { to_status: "READY", rack_location: rack.trim() || null },
        });
        message = `${order.tracking_code} siap diambil${updated.rack_location ? ` · rak ${updated.rack_location}` : ""}`;
      } else if (dialog.kind === "pickup") {
        updated = await api<Order>(`/orders/${order.id}/status`, {
          method: "POST",
          body: { to_status: "PICKED_UP", payment_method: order.is_paid ? null : method },
        });
        message = order.is_paid
          ? `${order.tracking_code} sudah diambil`
          : `${order.tracking_code} lunas ${PAYMENT_LABEL[method]} dan sudah diambil`;
      } else {
        updated = await api<Order>(`/orders/${order.id}/payment`, { method: "POST", body: { method } });
        message = `${order.tracking_code} lunas ${PAYMENT_LABEL[method]}`;
      }
      onDone(updated, message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  const title =
    dialog?.kind === "ready" ? "Tandai siap diambil" : dialog?.kind === "pickup" ? "Serahkan cucian" : "Terima pembayaran";
  const submitLabel =
    dialog?.kind === "ready"
      ? "Tandai siap"
      : dialog?.kind === "pickup"
        ? needsPayment
          ? `Terima ${PAYMENT_LABEL[method]} & serahkan`
          : "Ya, sudah diambil"
        : `Terima ${PAYMENT_LABEL[method]}`;

  return (
    <Modal
      open={dialog !== null}
      onClose={onClose}
      title={title}
      description={
        dialog?.kind === "ready"
          ? "Pelanggan dapat WhatsApp otomatis."
          : dialog?.kind === "pickup"
            ? "Cocokkan kode di nota."
            : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            loading={busy}
            variant={dialog?.kind === "pickup" && !needsPayment ? "dark" : "primary"}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {order && (
        <form id={FORM_ID} onSubmit={submit}>
          <Summary order={order} />
          {dialog?.kind === "ready" && (
            <Field label="Lokasi rak (opsional)">
              <input
                className={`${inputClass} font-mono uppercase`}
                value={rack}
                maxLength={20}
                autoFocus
                autoComplete="off"
                placeholder="mis. B3"
                onChange={(e) => setRack(e.target.value.toUpperCase())}
              />
            </Field>
          )}
          {dialog?.kind === "pickup" && order.rack_location && (
            <p className="mb-4 flex items-baseline gap-2 text-ink-2">
              <span className="label-caps">Ambil di rak</span>
              <span className="font-mono text-2xl font-semibold text-ink">{order.rack_location}</span>
            </p>
          )}
          {needsPayment && (
            <>
              {dialog?.kind === "pickup" && (
                <p className="mb-3 text-sm text-ink-2">
                  Belum lunas. Terima{" "}
                  <span className="tabular font-semibold text-ink">{formatRupiah(order.price_total)}</span> dulu.
                </p>
              )}
              <MethodPicker value={method} onChange={setMethod} />
            </>
          )}
          {error && (
            <div className="mt-4">
              <ErrorText message={error} />
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
