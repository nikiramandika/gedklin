"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconKey, IconUser, IconUsers } from "@/components/icons";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  SavedNote,
  Segmented,
  inputClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const ROLE_LABEL: Record<Role, string> = { owner: "Pemilik", admin: "Admin", cashier: "Kasir" };
const ROLE_STYLE: Record<Role, string> = {
  owner: "bg-nav text-white",
  admin: "bg-warn-50 text-warn-700",
  cashier: "bg-brand-50 text-brand-700",
};
const EMPTY = { name: "", username: "", password: "", role: "cashier" as Role };

export default function AkunPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
      return false;
    }
  }

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Akun Petugas"
        description="Kasir mencatat pesanan dan mengubah status. Admin hanya melihat daftar tindak lanjut."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          flush
          icon={IconUsers}
          title="Daftar akun"
          description={users ? `${users.length} akun terdaftar` : undefined}
        >
          {error && (
            <div className="px-4 pb-3 sm:px-5">
              <ErrorText message={error} />
            </div>
          )}
          {!users ? (
            <Loading rows={3} />
          ) : (
            <ul className={tileListClass}>
              {users.map((u) => (
                <UserRow key={u.id} user={u} onUpdate={update} />
              ))}
            </ul>
          )}
        </Card>

        <Card icon={IconUser} tone="ok" title="Tambah akun">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setCreated(false);
              setBusy(true);
              try {
                await api("/users", { method: "POST", body: form });
                setForm(EMPTY);
                setCreated(true);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Gagal menambah akun");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Peran">
              <Segmented<Role>
                label="Peran akun"
                value={form.role}
                onChange={(role) => setForm({ ...form, role })}
                options={[
                  { value: "cashier", label: "Kasir" },
                  { value: "admin", label: "Admin" },
                ]}
              />
            </Field>
            <Field label="Nama">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Username" hint="Minimal 3 karakter, dipakai untuk masuk.">
              <input
                className={inputClass}
                autoCapitalize="none"
                autoComplete="off"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                minLength={3}
              />
            </Field>
            <Field label="Password" hint="Minimal 8 karakter.">
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            <Button type="submit" className="w-full" loading={busy}>
              Tambah akun
            </Button>
            <SavedNote show={created} text="Akun ditambahkan" />
          </form>
        </Card>
      </div>
    </AppShell>
  );
}

function UserRow({
  user: u,
  onUpdate,
}: {
  user: User;
  onUpdate: (user: User, body: Partial<User> & { password?: string }) => Promise<boolean>;
}) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <li className={`${tileClass} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            u.is_active ? "bg-canvas text-ink-2" : "bg-canvas text-faint"
          }`}
        >
          {u.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join("")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`font-semibold ${u.is_active ? "text-ink" : "text-faint"}`}>{u.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[u.role]}`}>
              {ROLE_LABEL[u.role]}
            </span>
            {!u.is_active && (
              <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">Nonaktif</span>
            )}
          </div>
          <p className="font-mono text-[13px] text-muted">@{u.username}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => {
              setResetting((v) => !v);
              setDone(false);
            }}
          >
            <IconKey size={15} />
            Reset password
          </Button>
          {u.role !== "owner" && (
            <Button
              variant="ghost"
              size="sm"
              className={`flex-1 sm:flex-none ${u.is_active ? "text-danger-600 hover:bg-danger-50" : ""}`}
              onClick={() => onUpdate(u, { is_active: !u.is_active })}
            >
              {u.is_active ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          )}
        </div>
      </div>
      {resetting && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-subtle p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await onUpdate(u, { password });
            setBusy(false);
            if (ok) {
              setPassword("");
              setResetting(false);
              setDone(true);
            }
          }}
        >
          <Field label={`Password baru untuk @${u.username}`} hint="Minimal 8 karakter." className="min-w-0 flex-1">
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="mb-6 flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setResetting(false)}>
              Batal
            </Button>
            <Button type="submit" loading={busy}>
              Simpan
            </Button>
          </div>
        </form>
      )}
      {done && (
        <p className="mt-2">
          <SavedNote show text="Password diperbarui" />
        </p>
      )}
    </li>
  );
}
