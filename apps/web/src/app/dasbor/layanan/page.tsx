"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button, Card, ErrorText, Field, Loading, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import type { Role, Service } from "@/lib/types";

const ROLES: Role[] = ["owner"];

export default function LayananPage() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Service[]>("/services")
      .then(setServices)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <AppShell roles={ROLES}>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Layanan & Harga</h1>
      <ErrorText message={error} />
      {!services ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((s) => (
            <ServiceForm key={s.code} service={s} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function ServiceForm({ service }: { service: Service }) {
  const [form, setForm] = useState({
    name: service.name,
    regular: String(Number(service.price_per_kg_regular)),
    express: String(Number(service.price_per_kg_express)),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title={service.code}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          setError(null);
          try {
            await api(`/services/${service.code}`, {
              method: "PUT",
              body: {
                name: form.name,
                price_per_kg_regular: Number(form.regular),
                price_per_kg_express: Number(form.express),
              },
            });
            setMsg("Tersimpan");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          }
        }}
      >
        <Field label="Nama layanan">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Harga Reguler / kg">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={form.regular}
              onChange={(e) => setForm({ ...form, regular: e.target.value })}
            />
          </Field>
          <Field label="Harga Express / kg">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={form.express}
              onChange={(e) => setForm({ ...form, express: e.target.value })}
            />
          </Field>
        </div>
        <ErrorText message={error} />
        <div className="flex items-center gap-3">
          <Button type="submit">Simpan</Button>
          {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        </div>
      </form>
    </Card>
  );
}
