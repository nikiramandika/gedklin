"use client";

import { useState } from "react";

import { api } from "@/lib/api";

import { Modal, useToast } from "./overlay";
import { Button, ErrorText, Field, inputClass } from "./ui";

const FORM_ID = "change-password-form";

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Ganti password"
      description="Gunakan minimal 8 karakter dan jangan dibagikan ke petugas lain."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Batal
          </Button>
          <Button type="submit" form={FORM_ID} loading={busy}>
            Simpan password
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (next !== confirm) {
            setError("Konfirmasi password baru tidak sama.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await api("/auth/change-password", {
              method: "POST",
              body: { current_password: current, new_password: next },
            });
            toast("Password diganti");
            close();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal menyimpan");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Password saat ini">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password baru" hint="Minimal 8 karakter.">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        <Field label="Ulangi password baru">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        <ErrorText message={error} />
      </form>
    </Modal>
  );
}
