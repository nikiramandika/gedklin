"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconChat, IconPhone, IconReceipt, IconSearch, IconUser } from "@/components/icons";
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
  Switch,
  inputClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cleanPhoneInput, displayPhone, formatDateTime, formatRupiah, phoneError, summarizeItems } from "@/lib/format";
import type { CustomerDetail, CustomerSummary, Role } from "@/lib/types";

const ROLES: Role[] = ["owner", "cashier"];
const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;
const EDIT_FORM = "customer-edit-form";

type Filter = "all" | "unpaid";

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
      <PageHeader title="Pelanggan" description="Riwayat pesanan dan tagihan tiap pelanggan." />
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
              ? "Semua tagihan sudah lunas."
              : q
                ? "Cek ejaan nama atau nomor WA."
                : "Tercatat otomatis saat kasir membuat nota."}
          </EmptyState>
        ) : (
          <ul className={tileListClass}>
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className={`${tileClass} flex w-full flex-wrap items-center gap-3 px-4 py-4 text-left sm:px-5`}
                >
                  <span className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-ink">{c.name}</span>
                      {c.unpaid_total > 0 && (
                        <span className="label-caps inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-subtle px-2 py-1 leading-none ring-1 ring-inset ring-line text-warn-700">
                          Belum lunas <span className="tabular normal-case">{formatRupiah(c.unpaid_total)}</span>
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-muted">
                      <span className="tabular">{displayPhone(c.phone_wa)}</span>
                      {!c.has_whatsapp && " · tanpa WhatsApp"}
                    </span>
                  </span>
                  <span className="flex w-full items-baseline justify-between gap-3 sm:block sm:w-auto sm:text-right">
                    <span className="tabular order-2 block text-base font-semibold text-ink sm:order-none">{formatRupiah(c.total_spent)}</span>
                    <span className="block text-sm text-muted">
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
      description={
        customer ? (
          <span>
            <span className="tabular">{displayPhone(customer.phone_wa)}</span>
            {!customer.has_whatsapp && " · tanpa WhatsApp"}
          </span>
        ) : undefined
      }
      footer={
        customer && (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Ubah data
            </Button>
            {customer.has_whatsapp ? (
              <ButtonLink variant="whatsapp" href={`https://wa.me/${customer.phone_wa}`} target="_blank" rel="noopener noreferrer">
                <IconChat size={18} />
                Hubungi via WA
              </ButtonLink>
            ) : (
              <ButtonLink href={`tel:+${customer.phone_wa}`}>
                <IconPhone size={18} />
                Telepon
              </ButtonLink>
            )}
          </>
        )
      }
    >
      {error && <ErrorText message={error} />}
      {!customer ? (
        !error && <Loading rows={4} />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-2">
            {[
              ["Pesanan", String(customer.order_count)],
              ["Total belanja", formatRupiah(customer.total_spent)],
              ["Belum lunas", formatRupiah(customer.unpaid_total)],
            ].map(([label, value]) => (
              <div key={label} className="border-l border-line pl-3 first:border-l-0 first:pl-0">
                <dt className="label-caps text-muted">{label}</dt>
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
              <ul className="divide-y divide-dashed divide-field/50">
                {customer.orders.map((o) => (
                  <li key={o.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="serial text-sm">
                        {o.tracking_code}
                      </span>
                      <StatusBadge status={o.status} />
                      {o.status !== "CANCELLED" && <PaymentBadge paid={o.is_paid} />}
                      <span className="tabular ml-auto font-semibold text-ink">{formatRupiah(o.price_total)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-2">{summarizeItems(o.items)}</p>
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
  const [whatsapp, setWhatsapp] = useState(customer.has_whatsapp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ubah data pelanggan"
      description="Untuk nota dan kabar cucian siap diambil."
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
          const problem = phoneError(phone, whatsapp);
          if (problem) {
            setError(problem);
            return;
          }
          setBusy(true);
          setError(null);
          try {
            onSaved(
              await api<CustomerDetail>(`/customers/${customer.id}`, {
                method: "PATCH",
                body: { name: name.trim(), phone_wa: phone, has_whatsapp: whatsapp },
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
        <Field label={whatsapp ? "No. WhatsApp" : "No. HP / telepon"}>
          <input
            className={`${inputClass} tabular`}
            type="tel"
            inputMode="tel"
            maxLength={20}
            value={phone}
            onChange={(e) => setPhone(cleanPhoneInput(e.target.value))}
            required
          />
        </Field>
        <Switch
          label="Pakai WhatsApp"
          description={
            whatsapp ? "Nota dan kabar siap diambil dikirim lewat WA." : "Tidak ada WA yang dikirim ke pelanggan ini."
          }
          checked={whatsapp}
          onChange={setWhatsapp}
        />
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}
