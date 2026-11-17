"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { describeItem, formatDateTime, formatRupiah, paymentLabel, speedLabel } from "@/lib/format";
import type { Receipt, Role } from "@/lib/types";

import { IconArrowLeft, IconChat, IconPrinter } from "../icons";
import { Button, ButtonLink, ErrorText, Loading } from "../ui";

const ROLES: Role[] = ["cashier", "owner"];

export function ReceiptView({ id }: { id: string }) {
  const user = useRequireRole(ROLES);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<Receipt>(`/orders/${encodeURIComponent(id)}/receipt`)
      .then(setReceipt)
      .catch((e: Error) => setError(e.message));
  }, [id, user]);

  return (
    <main className="min-h-dvh bg-canvas px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-[360px]">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link
            href="/kasir"
            className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted hover:text-ink"
          >
            <IconArrowLeft size={18} />
            Kembali ke kasir
          </Link>
        </div>

        {error ? (
          <ErrorText message={error} />
        ) : !receipt ? (
          <div className="rounded-xl bg-surface">
            <Loading rows={6} />
          </div>
        ) : (
          <>
            <article className="rounded-xl bg-white px-5 py-6 font-mono text-[13px] leading-relaxed text-black shadow-raise ring-1 ring-line print:rounded-none print:px-0 print:py-0 print:shadow-none print:ring-0">
              <div className="text-center">
                <p className="text-base font-bold tracking-wide">GEDKLIN LAUNDRY</p>
                <p className="text-xs">Medan</p>
              </div>
              {receipt.order.status === "CANCELLED" && (
                <p className="mt-2 border border-black py-1 text-center font-bold">PESANAN DIBATALKAN</p>
              )}
              <Divider />
              <Row label="Kode" value={receipt.order.tracking_code} bold />
              <Row label="Pelanggan" value={receipt.order.customer.name} />
              <Row label="Masuk" value={formatDateTime(receipt.order.received_at)} />
              {receipt.order.created_by_name && <Row label="Kasir" value={receipt.order.created_by_name} />}
              <Row label="Kecepatan" value={speedLabel(receipt.order.is_express)} />
              <Divider />
              {receipt.order.items.map((item, i) => (
                <Row key={i} label={describeItem(item)} value={formatRupiah(item.subtotal)} />
              ))}
              <Divider />
              <Row label="TOTAL" value={formatRupiah(receipt.order.price_total)} bold />
              <Row
                label="Pembayaran"
                value={receipt.order.is_paid ? paymentLabel(receipt.order).toUpperCase() : "BELUM LUNAS"}
                bold
              />
              {receipt.order.notes && (
                <>
                  <Divider />
                  <p className="text-xs">Catatan:</p>
                  <p className="whitespace-pre-line text-xs">{receipt.order.notes}</p>
                </>
              )}
              <Divider />
              <p className="text-xs">Perkiraan siap diambil:</p>
              <p className="font-bold">{formatDateTime(receipt.order.predicted_ready_at)}</p>
              {receipt.order.promised_ready_at &&
                receipt.order.promised_ready_at !== receipt.order.predicted_ready_at && (
                  <p className="text-xs">Janji standar layanan: {formatDateTime(receipt.order.promised_ready_at)}</p>
                )}
              <p className="mt-2 text-xs">Lacak status cucian:</p>
              <p className="break-all text-xs">{receipt.tracking_url}</p>
              <p className="mt-4 text-center text-xs">Terima kasih!</p>
            </article>

            <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
              <Button size="lg" onClick={() => window.print()}>
                <IconPrinter size={18} />
                Cetak
              </Button>
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
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Divider() {
  return <hr className="my-2.5 border-dashed border-black" />;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className={`text-right tabular ${bold ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}
