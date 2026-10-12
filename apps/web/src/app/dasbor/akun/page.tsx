"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button, Card, ErrorText, Field, Loading, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const ROLE_LABEL: Record<Role, string> = { owner: "Pemilik", admin: "Admin", cashier: "Kasir" };
const EMPTY = { name: "", username: "", password: "", role: "cashier" as Role };

export default function AkunPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<User[]>("/users")
        .then(setUsers)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function update(user: User, body: Partial<User> & { password?: string }) {
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  return (
    <AppShell roles={ROLES}>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Akun Petugas</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card title="Daftar akun">
          <ErrorText message={error} />
          {!users ? (
            <Loading />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Nama</th>
                  <th className="py-2">Username</th>
                  <th className="py-2">Peran</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">{u.name}</td>
                    <td className="py-2 font-mono text-xs">{u.username}</td>
                    <td className="py-2">{ROLE_LABEL[u.role]}</td>
                    <td className="py-2">
                      {u.is_active ? (
                        <span className="text-emerald-700">Aktif</span>
                      ) : (
                        <span className="text-slate-400">Nonaktif</span>
                      )}
                    </td>
                    <td className="space-x-1 py-2 text-right">
                      {u.role !== "owner" && (
                        <Button
                          variant="ghost"
                          onClick={() => update(u, { is_active: !u.is_active })}
                        >
                          {u.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const pw = prompt(`Password baru untuk ${u.username} (min. 8 karakter)`);
                          if (pw) update(u, { password: pw });
                        }}
                      >
                        Reset Password
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Tambah akun">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await api("/users", { method: "POST", body: form });
                setForm(EMPTY);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Gagal menambah akun");
              }
            }}
          >
            <Field label="Nama">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Username">
              <input
                className={inputClass}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                minLength={3}
              />
            </Field>
            <Field label="Password (min. 8 karakter)">
              <input
                className={inputClass}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            <Field label="Peran">
              <select
                className={inputClass}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                <option value="cashier">Kasir</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Button type="submit" className="w-full">
              Tambah
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
