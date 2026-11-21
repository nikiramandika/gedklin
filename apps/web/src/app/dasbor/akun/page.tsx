"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconEdit, IconKey, IconPlus, IconUsers } from "@/components/icons";
import { ConfirmDialog, Modal, useToast } from "@/components/overlay";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  PageHeader,
  inputClass,
  tileClass,
  tileListClass,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

const ROLES: Role[] = ["owner"];
const ROLE_LABEL: Record<Role, string> = { owner: "Pemilik", cashier: "Staff Kasir", staff: "Staff" };
const ROLE_STYLE: Record<Role, string> = {
  owner: "text-ink",
  cashier: "text-brand-600",
  staff: "text-ok-700",
};
// Akun pemilik dibuat saat instalasi; dari sini pemilik hanya mengatur akun staff.
type StaffRole = Exclude<Role, "owner">;
const STAFF_ROLES: { value: StaffRole; description: string }[] = [
  { value: "cashier", description: "Di konter: terima pesanan, catat pembayaran, serahkan cucian, hubungi pelanggan." },
  { value: "staff", description: "Mengerjakan cucian: lihat antrean, tandai mulai dikerjakan dan siap diambil." },
];
const EMPTY = { name: "", username: "", password: "", role: "cashier" as StaffRole };
const CREATE_FORM = "create-user-form";
const EDIT_FORM = "edit-user-form";
const RESET_FORM = "reset-password-form";

export default function AkunPage() {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
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
        title="Akun Karyawan"
        description="Staff Kasir melayani di konter. Staff mengerjakan cucian lewat layar Antrean Cucian."
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
      >
        {error && (
          <div className="px-4 pb-3 sm:px-5">
            <ErrorText message={error} />
          </div>
        )}
        {!users ? (
          !error && <Loading rows={3} />
        ) : (
          <ul className={tileListClass}>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onEdit={() => setEditing(u)}
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
      <EditUserModal
        key={editing?.id ?? "closed"}
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={(user) => {
          setEditing(null);
          toast(`Akun ${user.name} diperbarui`);
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
  onEdit,
  onReset,
  onToggle,
}: {
  user: User;
  onEdit: () => void;
  onReset: () => void;
  onToggle: () => void;
}) {
  return (
    <li className={`${tileClass} flex flex-wrap items-center gap-3 px-4 py-3`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-base font-semibold ${u.is_active ? "text-ink" : "text-faint"}`}>{u.name}</p>
          <span className={`label-caps rounded-md bg-subtle px-2 py-1 leading-none ring-1 ring-inset ring-line ${ROLE_STYLE[u.role]}`}>
            {ROLE_LABEL[u.role]}
          </span>
          {!u.is_active && (
            <span className="label-caps rounded-md bg-subtle px-2 py-1 leading-none ring-1 ring-inset ring-line text-faint">
              Nonaktif
            </span>
          )}
        </div>
        <p className="font-mono text-sm text-muted">@{u.username}</p>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        {u.role !== "owner" && (
          <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={onEdit}>
            <IconEdit size={15} />
            Ubah
          </Button>
        )}
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
      description="Untuk masuk aplikasi."
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
        <RolePicker value={form.role} onChange={(role) => setForm({ ...form, role })} />
        <Field label="Nama">
          <input
            className={inputClass}
            value={form.name}
            autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="Username" hint="Minimal 3 karakter.">
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

function RolePicker({ value, onChange }: { value: StaffRole; onChange: (role: StaffRole) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-ink-2">Peran</legend>
      <div role="radiogroup" aria-label="Peran akun" className="grid gap-2 sm:grid-cols-2">
        {STAFF_ROLES.map((r) => {
          const active = r.value === value;
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(r.value)}
              className={`rounded-xl px-3 py-2.5 text-left ring-inset transition-[background-color,box-shadow] duration-150 ${
                active ? "bg-brand-50 ring-2 ring-brand-600" : "bg-surface ring-1 ring-line hover:bg-subtle"
              }`}
            >
              <span className={`block text-sm font-semibold ${active ? "text-brand-700" : "text-ink"}`}>
                {ROLE_LABEL[r.value]}
              </span>
              <span className="mt-0.5 block text-xs text-muted text-pretty">{r.description}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<StaffRole>(user && user.role !== "owner" ? user.role : "cashier");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roleChanged = user !== null && role !== user.role;

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Ubah akun"
      description={user ? `@${user.username}` : undefined}
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
          if (!user) return;
          setError(null);
          setBusy(true);
          try {
            const updated = await api<User>(`/users/${user.id}`, {
              method: "PATCH",
              body: { name: name.trim(), role },
            });
            onSaved(updated);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nama">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <RolePicker value={role} onChange={setRole} />
        {roleChanged && (
          <p className="text-sm text-muted">
            Menu {user?.name} ikut berubah saat ia membuka aplikasi lagi. Pesanan yang pernah dicatat tetap tersimpan.
          </p>
        )}
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
        <Field label="Password baru" hint="Minimal 8 karakter.">
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
