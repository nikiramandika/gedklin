"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, ErrorText, Field, inputClass } from "@/components/ui";
import { HOME_BY_ROLE, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(HOME_BY_ROLE[user.role]);
  }, [ready, user, router]);

  return (
    <main className="flex flex-1 items-center justify-center bg-slate-50 px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const u = await login(username, password);
            router.replace(HOME_BY_ROLE[u.role]);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal masuk");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Masuk Petugas</h1>
          <p className="text-sm text-slate-500">Gedklin Laundry</p>
        </div>
        <Field label="Username">
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Memproses..." : "Masuk"}
        </Button>
      </form>
    </main>
  );
}
