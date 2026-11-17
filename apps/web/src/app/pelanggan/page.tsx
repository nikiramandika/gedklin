"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconChat, IconReceipt, IconSearch, IconUser } from "@/components/icons";
import { Drawer, Modal, useToast } from "@/components/overlay";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  PaymentBadge,
  Segmented,
  StatusBadge,
  inputClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatRupiah, initials, summarizeItems } from "@/lib/format";
import type { CustomerDetail, CustomerSummary, Role } from "@/lib/types";

const ROLES: Role[] = ["owner", "cashier"];
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;
const EDIT_FORM = "customer-edit-form";

type Filter = "all" | "unpaid";

function displayPhone(phone: string): string {
  const local = phone.startsWith("62") ? `0${phone.slice(2)}` : phone;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

export default function PelangganPage() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<CustomerSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const fetchPage = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (q) params.set("q", q);
      if (filter === "unpaid") params.set("unpaid_only", "true");
      return api<CustomerSummary[]>(`/customers?${params}`);
    },
    [q, filter],
  );

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetchPage(0)
      .then((page) => {
        if (cancelled) return;
        setRows(page);
        setHasMore(page.length === PAGE_SIZE);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, version]);

  async function loadMore() {
    if (!rows) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(rows.length);
      setRows([...rows, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Pelanggan"
        description="Riwayat pesanan, total belanja, dan tagihan yang belum lunas per pelanggan."
      />
      <Card flush>
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <div className="relative min-w-0 flex-1">
            <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className={`${inputClass} pl-10`}
              type="search"
              enterKeyHint="search"
              placeholder="Nama atau nomor WhatsApp"
              aria-label="Cari pelanggan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-64">
            <Segmented<Filter>
              label="Saring pelanggan"
              value={filter}
              onChange={(f) => {
                setRows(null);
                setFilter(f);
              }}
              options={[
                { value: "all", label: "Semua" },
                { value: "unpaid", label: "Belum lunas" },
              ]}
            />
          </div>
        </div>

        {error && (
          <div className="px-4 pb-3 sm:px-5">
            <ErrorText message={error} />
          </div>
        )}

        {rows === null ? (
          !error && <Loading rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={IconUser} title={q || filter === "unpaid" ? "Tidak ditemukan" : "Belum ada pelanggan"}>
            {filter === "unpaid"
              ? "Tidak ada pelanggan dengan tagihan belum lunas."
              : q
                ? "Periksa ejaan nama atau nomor WhatsApp."
                : "Pelanggan tercatat otomatis saat kasir membuat pesanan."}
          </EmptyState>
        ) : (
          <ul className={tileListClass}>
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className={`${tileClass} flex w-full flex-wrap items-center gap-3 p-4 text-left`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-ink-2">
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{c.name}</span>
                      {c.unpaid_total > 0 && (
                        <span className="rounded-full bg-warn-50 px-2 py-0.5 text-xs font-semibold text-warn-700 ring-1 ring-inset ring-warn-600/20">
                          Belum lunas {formatRupiah(c.unpaid_total)}
                        </span>
                      )}
                    </span>
                    <span className="tabular block text-[13px] text-muted">{displayPhone(c.phone_wa)}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block font-semibold text-ink">{formatRupiah(c.total_spent)}</span>
                    <span className="block text-xs text-muted">
                      {c.order_count} pesanan
                      {c.last_order_at && ` · terakhir ${formatDateTime(c.last_order_at)}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {hasMore && (
              <li>
                <Button variant="secondary" className="w-full" loading={loadingMore} onClick={loadMore}>
                  Muat lebih banyak
                </Button>
              </li>
            )}
          </ul>
        )}
      </Card>

      {openId !== null && (
        <CustomerDrawer
          key={openId}
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </AppShell>
  );
}

function CustomerDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api<CustomerDetail>(`/customers/${id}`)
      .then(setCustomer)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={customer?.name ?? "Pelanggan"}
      description={customer ? <span className="tabular">{displayPhone(customer.phone_wa)}</span> : undefined}
      footer={
        customer && (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Ubah data
            </Button>
            <ButtonLink variant="whatsapp" href={`https://wa.me/${customer.phone_wa}`} target="_blank" rel="noopener noreferrer">
              <IconChat size={18} />
              Hubungi via WA
            </ButtonLink>
          </>
        )
      }
    >
      {error && <ErrorText message={error} />}
      {!customer ? (
        !error && <Loading rows={4} />
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-3 gap-2">
            {[
              ["Pesanan", String(customer.order_count)],
              ["Total belanja", formatRupiah(customer.total_spent)],
              ["Belum lunas", formatRupiah(customer.unpaid_total)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-subtle p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd
                  className={`tabular mt-0.5 truncate font-semibold ${
                    label === "Belum lunas" && customer.unpaid_total > 0 ? "text-warn-700" : "text-ink"
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">Riwayat pesanan</h3>
            {customer.orders.length === 0 ? (
              <p className="text-sm text-muted">Belum ada pesanan.</p>
            ) : (
              <ul className="space-y-2">
                {customer.orders.map((o) => (
                  <li key={o.id} className="rounded-xl bg-surface p-3 shadow-tile">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-medium tracking-wider text-brand-700">
                        {o.tracking_code}
                      </span>
                      <StatusBadge status={o.status} />
                      {o.status !== "CANCELLED" && <PaymentBadge paid={o.is_paid} />}
                      <span className="tabular ml-auto font-semibold text-ink">{formatRupiah(o.price_total)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{summarizeItems(o.items)}</p>
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
                      <span>{formatDateTime(o.received_at)}</span>
                      <a
                        href={`/nota/${o.id}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-brand-700"
                      >
                        <IconReceipt size={13} />
                        Nota
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {customer && (
        <EditCustomerModal
          key={`${customer.id}-${editing}`}
          customer={customer}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            setCustomer(updated);
            toast("Data pelanggan disimpan");
            onChanged();
          }}
        />
      )}
    </Drawer>
  );
}

function EditCustomerModal({
  customer,
  open,
  onClose,
  onSaved,
}: {
  customer: CustomerDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (customer: CustomerDetail) => void;
}) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(displayPhone(customer.phone_wa));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ubah data pelanggan"
      description="Nomor WhatsApp dipakai untuk nota dan notifikasi siap diambil."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={EDIT_FORM} loading={busy}>
            Simpan
          </Button>
        </>
      }
    >
      <form
        id={EDIT_FORM}
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onSaved(
              await api<CustomerDetail>(`/customers/${customer.id}`, {
                method: "PATCH",
                body: { name: name.trim(), phone_wa: phone },
              }),
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nama">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="No. WhatsApp">
          <input
            className={`${inputClass} tabular`}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}
