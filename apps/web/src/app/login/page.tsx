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
    <main className="relative flex min-h-dvh flex-1 flex-col items-center justify-center overflow-hidden bg-nav px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-brand-600/30 blur-3xl"
      />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <BrandMark size={44} />
          <div className="leading-tight">
            <p className="text-xl font-semibold">Gedklin</p>
            <p className="text-sm text-nav-faint">Laundry · Medan</p>
          </div>
        </div>

        <form
          className="space-y-4 rounded-2xl bg-surface p-6 shadow-pop sm:p-8"
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
          <div className="mb-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Masuk petugas</h1>
            <p className="mt-1 text-sm text-muted">Untuk kasir, admin, dan pemilik.</p>
          </div>
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
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {busy ? "Memproses..." : "Masuk"}
          </Button>
        </form>

        <Link
          href="/lacak"
          className="mt-6 flex h-11 items-center justify-center gap-2 text-sm font-medium text-nav-ink hover:text-white"
        >
          <IconSearch size={16} />
          Pelanggan? Lacak cucian di sini
        </Link>
      </div>
    </main>
  );
}
