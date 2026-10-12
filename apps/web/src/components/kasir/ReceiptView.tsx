"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import { describeItem, formatDateTime, formatRupiah, speedLabel } from "@/lib/format";
import type { Receipt, Role } from "@/lib/types";

import { Button, ErrorText, Loading } from "../ui";

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

  if (error) return <ErrorText message={error} />;
  if (!receipt) return <Loading />;
  const o = receipt.order;

  return (
    <div className="mx-auto w-full max-w-[320px] px-2 py-6 font-mono text-sm text-black print:py-0">
      <div className="text-center">
        <p className="text-base font-bold">GEDKLIN LAUNDRY</p>
        <p className="text-xs">Medan</p>
      </div>
      <hr className="my-2 border-dashed border-black" />
      <Row label="Kode" value={o.tracking_code} bold />
      <Row label="Pelanggan" value={o.customer.name} />
      <Row label="Masuk" value={formatDateTime(o.received_at)} />
      <Row label="Kecepatan" value={speedLabel(o.is_express)} />
      <hr className="my-2 border-dashed border-black" />
      {o.items.map((item, i) => (
        <Row key={i} label={describeItem(item)} value={formatRupiah(item.subtotal)} />
      ))}
      <hr className="my-2 border-dashed border-black" />
      <Row label="TOTAL" value={formatRupiah(o.price_total)} bold />
      <hr className="my-2 border-dashed border-black" />
      <p className="text-xs">Perkiraan siap diambil:</p>
      <p className="font-bold">{formatDateTime(o.predicted_ready_at)}</p>
      <p className="mt-2 text-xs">Lacak status cucian:</p>
      <p className="break-all text-xs">{receipt.tracking_url}</p>
      <p className="mt-3 text-center text-xs">Terima kasih!</p>

      <div className="mt-6 flex gap-2 print:hidden">
        <Button onClick={() => window.print()}>Cetak</Button>
        <a href={receipt.whatsapp_link} target="_blank" rel="noopener noreferrer">
          <Button variant="secondary">Kirim via WA</Button>
        </a>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className={`text-right ${bold ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}
