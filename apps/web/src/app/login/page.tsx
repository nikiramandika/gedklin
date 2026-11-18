"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark, IconSearch } from "@/components/icons";
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
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[360px]">
        <div className="mb-5 flex flex-col items-center text-center">
          <BrandMark size={40} />
          <h1 className="mt-4 text-xl font-semibold text-ink">Masuk ke Gedklin</h1>
          <p className="mt-1 text-sm text-muted">Kasir, admin, dan pemilik</p>
        </div>

        <form
          className="space-y-4 rounded-lg bg-surface p-5 shadow-card"
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
          <Field label="Username">
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
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
          <Button type="submit" className="w-full" loading={busy}>
            {busy ? "Memproses..." : "Masuk"}
          </Button>
        </form>

        <Link
          href="/lacak"
          className="mt-5 flex h-10 items-center justify-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
        >
          <IconSearch size={14} />
          Pelanggan? Lacak cucian
        </Link>
      </div>
    </main>
  );
}
