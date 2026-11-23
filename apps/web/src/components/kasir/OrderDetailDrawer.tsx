"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  STATUS_ACTION,
  STATUS_LABEL,
  displayPhone,
  etaState,
  formatDateTime,
  formatKg,
  formatRupiah,
  lineDetail,
  paymentLabel,
  relativeEta,
  speedLabel,
} from "@/lib/format";
import type { Order, OrderDetail, OrderNotification, Receipt } from "@/lib/types";
import { useNow } from "@/lib/useNow";

import { IconChat, IconEdit, IconHistory, IconPhone, IconPrinter } from "../icons";
import { ConfirmDialog, Drawer, Modal } from "../overlay";
import {
  Alert,
  Button,
  ButtonLink,
  ErrorText,
  ExpressBadge,
  Field,
  Loading,
  PaymentBadge,
  StatusBadge,
  inputClass,
  textareaClass,
} from "../ui";
import { ItemLines, SpeedField, useItemEditor } from "./ItemEditor";

const NOTIF_LABEL: Record<OrderNotification["type"], string> = {
  RECEIPT: "Nota",
  READY: "Siap diambil",
  DELAY: "Kabar keterlambatan",
};
const NOTIF_STATUS: Record<OrderNotification["status"], string> = {
  PENDING: "Menunggu",
  SENT: "Terkirim",
  FAILED: "Gagal",
};
const ITEMS_FORM = "order-items-form";
const DETAILS_FORM = "order-details-form";

interface Props {
  onClose: () => void;
  onAdvance: (order: Order) => Promise<void>;
  onPay: (order: Order) => void;
  onChanged: (message: string) => Promise<void>;
}

export function OrderDetailDrawer({
  orderId,
  version,
  ...props
}: Props & { orderId: number | null; version: number }) {
  // Dipasang ulang per pesanan (key) supaya isi pesanan sebelumnya tidak sempat tampil.
  if (orderId === null) return null;
  return <OrderDetailPanel key={orderId} orderId={orderId} version={version} {...props} />;
}

function OrderDetailPanel({
  orderId,
  version,
  onClose,
  onAdvance,
  onPay,
  onChanged,
}: Props & { orderId: number; version: number }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [notifs, setNotifs] = useState<OrderNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "items">("view");
  const [itemsBusy, setItemsBusy] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "void" | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const now = useNow();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const load = useCallback(
    (id: number) =>
      Promise.all([
        api<OrderDetail>(`/orders/${id}`),
        api<Receipt>(`/orders/${id}/receipt`),
        api<OrderNotification[]>(`/orders/${id}/notifications`),
      ])
        .then(([o, r, n]) => {
          setOrder(o);
          setReceipt(r);
          setNotifs(n);
          setError(null);
        })
        .catch((err: Error) => setError(err.message)),
    [],
  );

  // `version` naik setiap kali papan mengubah pesanan (status, bayar), jadi detail ikut segar.
  useEffect(() => {
    load(orderId);
  }, [orderId, version, load]);

  async function advance() {
    if (!order) return;
    setBusy(true);
    await onAdvance(order);
    setBusy(false);
  }

  async function changed(message: string) {
    await onChanged(message);
    await load(orderId);
  }

  async function runConfirm() {
    if (!order || !confirm) return;
    if (confirm === "cancel" && reason.trim().length < 3) {
      setConfirmError("Isi alasan pembatalan.");
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (confirm === "cancel") {
        await api(`/orders/${order.id}/cancel`, { method: "POST", body: { reason: reason.trim() } });
        await changed(`${order.tracking_code} dibatalkan`);
      } else {
        await api(`/orders/${order.id}/payment`, { method: "DELETE" });
        await changed(`Pembayaran ${order.tracking_code} dibatalkan`);
      }
      setConfirm(null);
      setReason("");
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setConfirmBusy(false);
    }
  }

  const next = order?.next_status ?? null;
  const editable = !!order && (order.status === "RECEIVED" || order.status === "PROCESSING") && !order.is_paid;
  const cancelled = order?.status === "CANCELLED";
  const timing = order ? etaState(order, now) : null;
  const wa = order?.customer.has_whatsapp ?? true;

  if (mode === "items" && order) {
    return (
      <Drawer
        open
        onClose={() => setMode("view")}
        title="Ubah isi pesanan"
        description={`${order.customer.name} · ${order.tracking_code}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode("view")} disabled={itemsBusy}>
              Batal
            </Button>
            <Button type="submit" form={ITEMS_FORM} loading={itemsBusy}>
              Simpan
            </Button>
          </>
        }
      >
        <ItemsCorrection
          order={order}
          onBusy={setItemsBusy}
          onSaved={async (message) => {
            setMode("view");
            await changed(message);
          }}
        />
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={order ? order.customer.name : "Detail pesanan"}
      description={
        order ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="serial">{order.tracking_code}</span>
            {isOwner && (
              <Link
                href={`/dasbor/log?q=${encodeURIComponent(order.tracking_code)}`}
                className="inline-flex items-center gap-1 rounded text-xs font-medium text-ink-2 underline-offset-4 hover:text-brand-700 hover:underline"
              >
                <IconHistory size={14} />
                Riwayat perubahan
              </Link>
            )}
          </span>
        ) : undefined
      }
      footer={
        order && (
          <div className="grid w-full gap-2">
            {next && (
              <Button size="lg" variant={next === "PICKED_UP" ? "dark" : "primary"} loading={busy} onClick={advance}>
                {STATUS_ACTION[next]}
              </Button>
            )}
            {!cancelled && (
              <div className="grid grid-cols-2 gap-2">
                {wa ? (
                  <ButtonLink
                    variant="secondary"
                    href={receipt?.whatsapp_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!receipt}
                    className={receipt ? "" : "pointer-events-none opacity-50"}
                  >
                    <IconChat size={16} className="text-ok-600" />
                    Kirim nota WA
                  </ButtonLink>
                ) : (
                  <ButtonLink variant="secondary" href={`tel:+${order.customer.phone_wa}`}>
                    <IconPhone size={16} className="text-brand-600" />
                    Telepon
                  </ButtonLink>
                )}
                <ButtonLink variant="secondary" href={`/nota/${order.id}`} target="_blank" rel="noopener">
                  <IconPrinter size={16} />
                  Cetak nota
                </ButtonLink>
              </div>
            )}
          </div>
        )
      }
    >
      {error && <ErrorText message={error} />}
      {!order ? (
        !error && <Loading rows={4} />
      ) : (
        <div className="space-y-5">
          {cancelled && (
            <Alert tone="danger">
              Dibatalkan {formatDateTime(order.cancelled_at)}
              {order.cancel_reason && <span className="block">Alasan: {order.cancel_reason}</span>}
            </Alert>
          )}

          <section className="rounded-xl bg-subtle p-4 ring-1 ring-inset ring-line">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={order.status} />
              {order.is_express && <ExpressBadge />}
              {!cancelled && <PaymentBadge paid={order.is_paid} />}
              {order.needs_followup && (
                <span className="rounded-sm bg-warn-50 px-2 py-0.5 text-xs font-medium text-warn-700">
                  Perlu tindak lanjut
                </span>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
              {!cancelled && (
                <>
                  {order.ready_at && (
                    <>
                      <dt className="text-muted">Siap sejak</dt>
                      <dd className="text-right font-medium text-ink">{formatDateTime(order.ready_at)}</dd>
                    </>
                  )}
                  <dt className="text-muted">Janji siap</dt>
                  <dd className="text-right">
                    <span className={timing === "late" ? "font-medium text-danger-600" : "text-ink-2"}>
                      {formatDateTime(order.promised_ready_at)}
                    </span>
                    {timing === "late" && (
                      <span className="block text-xs font-medium text-danger-600 first-letter:uppercase">
                        {relativeEta(order.promised_ready_at, now)}
                      </span>
                    )}
                  </dd>
                </>
              )}
              <dt className="text-muted">Diterima</dt>
              <dd className="text-right text-ink-2">
                {formatDateTime(order.received_at)}
                {order.created_by_name && (
                  <span className="block text-xs text-muted">oleh {order.created_by_name}</span>
                )}
              </dd>
              {order.rack_location && (
                <>
                  <dt className="text-muted">Rak</dt>
                  <dd className="text-right font-mono font-semibold text-ink">{order.rack_location}</dd>
                </>
              )}
              <dt className="text-muted">{wa ? "WhatsApp" : "Telepon"}</dt>
              <dd className="tabular text-right text-ink-2">{displayPhone(order.customer.phone_wa)}</dd>
            </dl>
          </section>

          {!cancelled && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4 shadow-tile">
              <div>
                <p className="text-sm text-muted">Total</p>
                <p className="tabular text-lg font-semibold text-ink">{formatRupiah(order.price_total)}</p>
                <p className="text-xs text-ink-2">
                  {paymentLabel(order)}
                  {order.paid_at && ` · ${formatDateTime(order.paid_at)}`}
                </p>
              </div>
              {order.is_paid ? (
                isOwner && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-danger-700! ring-1 ring-danger-600/30 hover:bg-danger-50!"
                    onClick={() => {
                      setConfirmError(null);
                      setConfirm("void");
                    }}
                  >
                    Batalkan pembayaran
                  </Button>
                )
              ) : (
                <Button variant="secondary" onClick={() => onPay(order)}>
                  Terima pembayaran
                </Button>
              )}
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Catatan</h3>
              {!cancelled && (
                <Button variant="secondary" size="sm" onClick={() => setEditingDetails(true)}>
                  <IconEdit size={14} className="text-brand-600" />
                  Ubah
                </Button>
              )}
            </div>
            <p className={`whitespace-pre-line text-sm ${order.notes ? "text-ink-2" : "text-muted"}`}>
              {order.notes ?? "–"}
            </p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Isi pesanan · {speedLabel(order.is_express)}</h3>
              {editable && (
                <Button variant="secondary" size="sm" onClick={() => setMode("items")}>
                  <IconEdit size={14} className="text-brand-600" />
                  Ubah
                </Button>
              )}
            </div>
            <ul className="space-y-2">
              {order.items.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-4 rounded-xl bg-surface p-3 shadow-tile">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-xs text-muted">
                      {[
                        item.weight_kg !== null ? formatKg(item.weight_kg) : null,
                        item.qty_pcs ? `${item.qty_pcs} pcs` : null,
                        lineDetail(item) || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <p className="tabular shrink-0 font-medium text-ink">{formatRupiah(item.subtotal)}</p>
                </li>
              ))}
            </ul>
            {!editable && !cancelled && (order.status === "RECEIVED" || order.status === "PROCESSING") && (
              <p className="mt-2 text-sm text-muted">
                {isOwner
                  ? "Sudah lunas. Batalkan pembayaran dulu untuk mengubah isi."
                  : "Sudah lunas. Hubungi pemilik bila isi salah."}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink">Riwayat status</h3>
            <ol className="space-y-3">
              {order.history.map((h, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      i === order.history.length - 1 ? "bg-brand-600 ring-4 ring-brand-100" : "bg-line-strong"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{STATUS_LABEL[h.to_status]}</span>
                    {h.changed_by_name && <span className="block text-xs text-muted">oleh {h.changed_by_name}</span>}
                  </span>
                  <span className="shrink-0 text-muted">{formatDateTime(h.changed_at)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">WhatsApp</h3>
            {notifs.length === 0 ? (
              <p className="text-sm text-muted">{wa ? "Belum ada pesan terkirim." : "Pelanggan tanpa WhatsApp."}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {notifs.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink-2">{NOTIF_LABEL[n.type]}</span>
                    <span className={n.status === "FAILED" ? "font-medium text-danger-600" : "text-muted"}>
                      {NOTIF_STATUS[n.status]}
                      {n.sent_at && ` · ${formatDateTime(n.sent_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {editable && (
            <div className="border-t border-line pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-700"
                onClick={() => {
                  setConfirmError(null);
                  setConfirm("cancel");
                }}
              >
                Batalkan pesanan
              </Button>
            </div>
          )}
        </div>
      )}

      {order && (
        <DetailsModal
          key={`${order.id}-${editingDetails}`}
          order={order}
          open={editingDetails}
          onClose={() => setEditingDetails(false)}
          onSaved={async () => {
            setEditingDetails(false);
            await changed("Catatan pesanan disimpan");
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        busy={confirmBusy}
        error={confirmError}
        tone={confirm === "cancel" ? "danger" : "warn"}
        title={confirm === "cancel" ? `Batalkan pesanan ${order?.tracking_code ?? ""}?` : "Batalkan pembayaran?"}
        confirmLabel={confirm === "cancel" ? "Batalkan pesanan" : "Batalkan pembayaran"}
      >
        {confirm === "cancel" ? (
          <div className="space-y-3">
            <p>Pesanan keluar dari antrean dan tidak dihitung sebagai pendapatan. Tidak bisa dikembalikan.</p>
            <Field label="Alasan">
              <textarea
                className={textareaClass}
                rows={2}
                maxLength={255}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contoh: pelanggan batal"
              />
            </Field>
          </div>
        ) : (
          "Pesanan kembali tercatat belum lunas."
        )}
      </ConfirmDialog>
    </Drawer>
  );
}

function ItemsCorrection({
  order,
  onBusy,
  onSaved,
}: {
  order: Order;
  onBusy: (busy: boolean) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const editor = useItemEditor({ items: order.items, isExpress: order.is_express });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editor.ready) return;
    setError(null);
    onBusy(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/items`, {
        method: "PUT",
        body: { is_express: editor.express, items: editor.items },
      });
      await onSaved(`Isi ${updated.tracking_code} dikoreksi · ${formatRupiah(updated.price_total)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      onBusy(false);
    }
  }

  const diff = editor.quote ? editor.quote.total - order.price_total : 0;
  return (
    <form id={ITEMS_FORM} onSubmit={submit} className="space-y-5">
      {editor.unavailable && (
        <Alert tone="warn">Ada layanan yang sudah tidak tersedia. Ganti dulu sebelum menyimpan.</Alert>
      )}
      <ItemLines editor={editor} />
      <SpeedField editor={editor} />
      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-sm text-muted">
          Total baru
          {editor.quote && diff !== 0 && (
            <span className="block text-xs">
              {diff > 0 ? "+" : "−"}
              {formatRupiah(Math.abs(diff))} dari {formatRupiah(order.price_total)}
            </span>
          )}
        </span>
        <span className="tabular text-xl font-semibold tracking-tight text-ink">
          {editor.quote ? formatRupiah(editor.quote.total) : "Rp –"}
        </span>
      </div>
      <ErrorText message={error ?? editor.quoteError ?? editor.catalogError} />
    </form>
  );
}

function DetailsModal({
  order,
  open,
  onClose,
  onSaved,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [notes, setNotes] = useState(order.notes ?? "");
  const [rack, setRack] = useState(order.rack_location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catatan & rak"
      description={`${order.customer.name} · ${order.tracking_code}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={DETAILS_FORM} loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form
        id={DETAILS_FORM}
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/orders/${order.id}`, {
              method: "PATCH",
              body: { notes: notes.trim() || null, rack_location: rack.trim() || null },
            });
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Catatan">
          <textarea
            className={textareaClass}
            rows={3}
            maxLength={1000}
            value={notes}
            autoFocus
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Field label="Rak">
          <input
            className={`${inputClass} font-mono uppercase`}
            maxLength={20}
            value={rack}
            placeholder="Contoh: B3"
            onChange={(e) => setRack(e.target.value.toUpperCase())}
          />
        </Field>
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}
