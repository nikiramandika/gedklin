"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconAlert, IconChat, IconPackageCheck, IconPhone, IconRefresh } from "@/components/icons";
import {
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  ExpressBadge,
  PaymentBadge,
  IconButton,
  Loading,
  PageHeader,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { displayPhone, formatDateTime, formatRupiah, summarizeItems } from "@/lib/format";
import type { Order, Role } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const ROLES: Role[] = ["cashier", "owner"];
const readyDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  weekday: "long",
  day: "numeric",
  month: "long",
});

// Pesan pembuka untuk kasir; tetap bisa diubah di WhatsApp sebelum dikirim.
function reminderLink(o: Order): string {
  const since = o.ready_at ? ` sejak ${readyDate.format(new Date(o.ready_at))}` : "";
  const bill = o.is_paid ? "" : ` Total tagihan ${formatRupiah(o.price_total)}, bisa dibayar saat ambil.`;
  const text = `Halo ${o.customer.name}, cucian Anda di Gedklin Laundry (kode ${o.tracking_code}) sudah siap diambil${since}.${bill} Terima kasih.`;
  return `https://wa.me/${o.customer.phone_wa}?text=${encodeURIComponent(text)}`;
}

function daysSince(iso: string | null, now: number): number {
  if (!iso || !now) return 0;
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export default function TindakLanjutPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  const load = useCallback(
    () =>
      api<Order[]>("/followups")
        .then((o) => {
          setOrders(o);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const sorted = orders
    ? [...orders].sort((a, b) => daysSince(b.ready_at, now) - daysSince(a.ready_at, now))
    : null;

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Tindak Lanjut"
        description="Siap lebih dari 3 hari, belum diambil. Hubungi pelanggan langsung."
      />
      <Card
        flush
        icon={IconAlert}
        tone="warn"
        title={sorted ? `${sorted.length} pesanan menunggu` : "Pesanan menunggu"}
        description="Paling lama di atas"
        action={
          <IconButton
            label="Muat ulang"
            icon={IconRefresh}
            size={18}
            onClick={refresh}
            disabled={refreshing}
            className={refreshing ? "[&_svg]:animate-spin" : ""}
          />
        }
      >
        {error && (
          <div className="p-4">
            <ErrorText message={error} />
          </div>
        )}
        {!sorted ? (
          !error && <Loading rows={4} />
        ) : sorted.length === 0 ? (
          <EmptyState icon={IconPackageCheck} title="Semua beres">
            Tidak ada cucian yang menunggu lebih dari 3 hari.
          </EmptyState>
        ) : (
          <ul className={tileListClass}>
            {sorted.map((o) => {
              const days = daysSince(o.ready_at, now);
              return (
                <li
                  key={o.id}
                  className={`${tileClass} grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5`}
                >
                  <div className="flex min-w-0 gap-4">
                    <div className="flex w-14 shrink-0 flex-col items-center pt-0.5 text-warn-700">
                      <span className="tabular display text-2xl leading-none">{days}</span>
                      <span className="label-caps mt-1">hari</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-ink">{o.customer.name}</p>
                        {o.is_express && <ExpressBadge />}
                        <PaymentBadge paid={o.is_paid} />
                        {o.rack_location && (
                          <span className="inline-flex items-center gap-1 rounded bg-subtle px-1.5 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">
                            Rak <span className="font-mono font-semibold text-ink">{o.rack_location}</span>
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">
                        <span className="serial">{o.tracking_code}</span>{" "}
                        · <span className="tabular">{displayPhone(o.customer.phone_wa)}</span>
                        {!o.customer.has_whatsapp && " (tanpa WA)"} ·{" "}
                        <span className="tabular">{formatRupiah(o.price_total)}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-2">{summarizeItems(o.items)}</p>
                      <p className="mt-1 text-sm text-muted">Siap sejak {formatDateTime(o.ready_at)}</p>
                    </div>
                  </div>
                  {o.customer.has_whatsapp ? (
                    <ButtonLink
                      variant="whatsapp"
                      href={reminderLink(o)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full sm:w-auto"
                    >
                      <IconChat size={18} />
                      Hubungi WA
                    </ButtonLink>
                  ) : (
                    <ButtonLink href={`tel:+${o.customer.phone_wa}`} className="w-full sm:w-auto">
                      <IconPhone size={18} />
                      Telepon
                    </ButtonLink>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
