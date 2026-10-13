"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconKey, IconPlus, IconUsers } from "@/components/icons";
import { ConfirmDialog, Modal, useToast } from "@/components/overlay";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  PageHeader,
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
const CREATE_FORM = "create-user-form";
const RESET_FORM = "reset-password-form";

export default function AkunPage() {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [toggling, setToggling] = useState<User | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

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

  async function confirmToggle() {
    if (!toggling) return;
    const user = toggling;
    setToggleBusy(true);
    setToggleError(null);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { is_active: !user.is_active } });
      toast(`${user.name} ${user.is_active ? "dinonaktifkan" : "diaktifkan"}`);
      setToggling(null);
      await load();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <AppShell roles={ROLES}>
      <PageHeader
        title="Akun Petugas"
        description="Kasir mencatat pesanan dan mengubah status. Admin hanya melihat daftar tindak lanjut."
        actions={
          <Button onClick={() => setCreating(true)}>
            <IconPlus size={18} />
            Tambah akun
          </Button>
        }
      />
      <Card
        flush
        icon={IconUsers}
        title="Daftar akun"
        description={users ? `${users.length} akun terdaftar` : undefined}
        className="max-w"
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
              <UserRow
                key={u.id}
                user={u}
                onReset={() => setResetting(u)}
                onToggle={() => {
                  setToggleError(null);
                  setToggling(u);
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(user) => {
          setCreating(false);
          toast(`Akun @${user.username} ditambahkan`);
          load();
        }}
      />
      <ResetPasswordModal
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(user) => {
          setResetting(null);
          toast(`Password @${user.username} diperbarui`);
        }}
      />
      <ConfirmDialog
        open={toggling !== null}
        onClose={() => setToggling(null)}
        onConfirm={confirmToggle}
        busy={toggleBusy}
        error={toggleError}
        tone={toggling?.is_active ? "warn" : "brand"}
        title={`${toggling?.is_active ? "Nonaktifkan" : "Aktifkan"} akun ${toggling?.name ?? ""}?`}
        confirmLabel={toggling?.is_active ? "Nonaktifkan" : "Aktifkan"}
      >
        {toggling?.is_active
          ? `@${toggling.username} tidak bisa masuk lagi sampai diaktifkan kembali. Pesanan yang pernah dicatatnya tetap tersimpan.`
          : `@${toggling?.username ?? ""} bisa masuk lagi dengan password yang terakhir dipakai.`}
      </ConfirmDialog>
    </AppShell>
  );
}

function UserRow({
  user: u,
  onReset,
  onToggle,
}: {
  user: User;
  onReset: () => void;
  onToggle: () => void;
}) {
  return (
    <li className={`${tileClass} flex flex-wrap items-center gap-3 p-4`}>
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
        <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={onReset}>
          <IconKey size={15} />
          Reset password
        </Button>
        {u.role !== "owner" && (
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 sm:flex-none ${u.is_active ? "text-danger-600 hover:bg-danger-50" : ""}`}
            onClick={onToggle}
          >
            {u.is_active ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        )}
      </div>
    </li>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (user: User) => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setForm(EMPTY);
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Tambah akun"
      description="Petugas masuk dengan username dan password ini."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={CREATE_FORM} loading={busy}>
            Tambah akun
          </Button>
        </>
      }
    >
      <form
        id={CREATE_FORM}
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const user = await api<User>("/users", { method: "POST", body: form });
            setForm(EMPTY);
            onCreated(user);
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
            autoFocus
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
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: User | null;
  onClose: () => void;
  onDone: (user: User) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setPassword("");
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={user !== null}
      onClose={close}
      title="Reset password"
      description={user ? `Password baru untuk ${user.name} (@${user.username}).` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={RESET_FORM} loading={busy}>
            Simpan password
          </Button>
        </>
      }
    >
      <form
        id={RESET_FORM}
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!user) return;
          setError(null);
          setBusy(true);
          try {
            await api(`/users/${user.id}`, { method: "PATCH", body: { password } });
            setPassword("");
            onDone(user);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Password baru" hint="Minimal 8 karakter. Sampaikan langsung ke petugasnya.">
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
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}
