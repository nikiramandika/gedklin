"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth, useRequireRole } from "@/lib/auth";
import type { Role } from "@/lib/types";

import { Loading } from "./ui";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/dasbor", label: "Dasbor", roles: ["owner"] },
  { href: "/kasir", label: "Kasir", roles: ["owner", "cashier"] },
  { href: "/admin", label: "Tindak Lanjut", roles: ["owner", "admin"] },
  { href: "/dasbor/operasional", label: "Operasional", roles: ["owner"] },
  { href: "/dasbor/layanan", label: "Layanan", roles: ["owner"] },
  { href: "/dasbor/akun", label: "Akun", roles: ["owner"] },
];

const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  admin: "Admin",
  cashier: "Kasir",
};

export function AppShell({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useRequireRole(roles);
  const { logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (!user) return <Loading />;

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-teal-700">
            Gedklin
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV.filter((n) => n.roles.includes(user.role)).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  pathname === n.href
                    ? "bg-teal-50 font-medium text-teal-800"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user.name} <span className="text-slate-400">({ROLE_LABEL[user.role]})</span>
            </span>
            <button
              className="text-slate-500 hover:text-rose-600"
              onClick={() => {
                logout();
                router.replace("/login");
              }}
            >
              Keluar
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
