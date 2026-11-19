"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLockup, DrumRings } from "@/components/brand";
import { IconEye, IconEyeOff, IconSearch } from "@/components/icons";
import { Button, ErrorText, Field, IconButton, inputClass } from "@/components/ui";
import { HOME_BY_ROLE, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(HOME_BY_ROLE[user.role]);
  }, [ready, user, router]);

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(440px,40%)]">
      {/* Pita merek: di HP jadi kepala halaman, di desktop jadi panel kiri. */}
      <aside className="pt-safe relative overflow-hidden bg-nav px-5 pb-20 pt-8 text-white lg:flex lg:flex-col lg:justify-between lg:px-12 lg:pb-12 lg:pt-12">
        <DrumRings className="-right-28 -top-24 w-[340px] lg:-bottom-40 lg:-right-40 lg:top-auto lg:w-[640px]" />
        <div className="relative">
          <BrandLockup />
        </div>
        <div className="relative hidden max-w-md lg:block">
          <p className="display text-4xl leading-tight text-white text-balance">
            Kasir, dasbor, dan pelacakan cucian dalam satu tempat.
          </p>
        </div>
      </aside>

      <section className="relative -mt-12 flex flex-1 justify-center px-4 pb-10 lg:mt-0 lg:items-center lg:px-12">
        <div className="w-full max-w-[400px]">
          <form
            className="rounded-2xl bg-surface p-6 shadow-pop sm:p-7 lg:shadow-card"
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
            <h1 className="display text-2xl text-ink">Masuk ke Gedklin</h1>
            <p className="mt-1 text-sm text-muted">Kasir, admin, dan pemilik</p>

            <div className="mt-6 space-y-4">
              <Field label="Username">
                <input
                  className={inputClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    className={`${inputClass} pr-12`}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <IconButton
                    label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    icon={showPassword ? IconEyeOff : IconEye}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2"
                  />
                </div>
              </Field>
              <ErrorText message={error} />
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                {busy ? "Memproses..." : "Masuk"}
              </Button>
            </div>
          </form>

          <Link
            href="/lacak"
            className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-brand-700"
          >
            <IconSearch size={15} />
            Pelanggan? Lacak cucian
          </Link>
        </div>
      </section>
    </main>
  );
}
