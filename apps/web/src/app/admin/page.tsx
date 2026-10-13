"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconAlert, IconChat, IconPackageCheck, IconRefresh } from "@/components/icons";
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
import { formatDateTime, formatRupiah, summarizeItems } from "@/lib/format";
import type { Order, Role } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const ROLES: Role[] = ["admin", "owner"];

function daysSince(iso: string | null, now: number): number {
  if (!iso || !now) return 0;
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(
    () =>
      api<Order[]>("/admin/followups")
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

  const sorted = orders
    ? [...orders].sort((a, b) => daysSince(b.ready_at, now) - daysSince(a.ready_at, now))
    : null;

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Tindak Lanjut"
        description="Cucian yang sudah siap lebih dari 3 hari tetapi belum diambil. Sistem tidak mengirim WA otomatis untuk ini; hubungi pelanggan secara manual."
      />
      <Card
        flush
        icon={IconAlert}
        tone="warn"
        title={sorted ? `${sorted.length} pesanan menunggu` : "Pesanan menunggu"}
        description="Diurutkan dari yang paling lama"
        action={<IconButton label="Muat ulang" icon={IconRefresh} size={18} onClick={load} />}
      >
        {error && (
          <div className="p-4">
            <ErrorText message={error} />
          </div>
        )}
        {!sorted ? (
          <Loading rows={4} />
        ) : sorted.length === 0 ? (
          <EmptyState icon={IconPackageCheck} title="Tidak ada yang perlu ditindaklanjuti">
            Semua cucian yang siap sudah diambil dalam 3 hari. Daftar diperbarui otomatis setiap hari.
          </EmptyState>
        ) : (
          <ul className={tileListClass}>
            {sorted.map((o) => {
              const days = daysSince(o.ready_at, now);
              return (
                <li
                  key={o.id}
                  className={`${tileClass} grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center`}
                >
                  <div className="flex min-w-0 gap-4">
                    <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-warn-50 py-2 text-warn-700 ring-1 ring-inset ring-warn-600/15">
                      <span className="tabular text-xl font-semibold leading-none">{days}</span>
                      <span className="mt-1 text-[11px] font-medium">hari</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{o.customer.name}</p>
                        {o.is_express && <ExpressBadge />}
                        <PaymentBadge paid={o.is_paid} />
                        {o.rack_location && (
                          <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-xs font-semibold text-ink-2">
                            Rak {o.rack_location}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">
                        <span className="font-mono font-medium tracking-wider text-ink-2">
                          {o.tracking_code}
                        </span>{" "}
                        · <span className="tabular">+{o.customer.phone_wa}</span> ·{" "}
                        <span className="tabular">{formatRupiah(o.price_total)}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{summarizeItems(o.items)}</p>
                      <p className="mt-1 text-xs text-muted">Siap sejak {formatDateTime(o.ready_at)}</p>
                    </div>
                  </div>
                  <ButtonLink
                    variant="whatsapp"
                    href={`https://wa.me/${o.customer.phone_wa}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto"
                  >
                    <IconChat size={18} />
                    Hubungi via WA
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
