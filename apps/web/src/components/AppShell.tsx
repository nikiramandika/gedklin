"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";

import { useAuth, useRequireRole } from "@/lib/auth";
import { useInstallPrompt, useOnline } from "@/lib/pwa";
import type { Role, User } from "@/lib/types";

import {
  BrandMark,
  IconAlert,
  IconCalendar,
  IconChart,
  IconDashboard,
  IconDownload,
  IconHistory,
  IconKey,
  IconLogOut,
  IconMenu,
  IconReceipt,
  IconTag,
  IconUser,
  IconUsers,
  IconWifiOff,
  IconX,
} from "./icons";
import { ChangePasswordModal } from "./ChangePasswordModal";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  roles: Role[];
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Kerja harian",
    items: [
      { href: "/dasbor", label: "Dasbor", icon: IconDashboard, roles: ["owner"] },
      { href: "/kasir", label: "Kasir", icon: IconReceipt, roles: ["owner", "cashier"] },
      { href: "/pelanggan", label: "Pelanggan", icon: IconUser, roles: ["owner", "cashier"] },
      { href: "/admin", label: "Tindak Lanjut", icon: IconAlert, roles: ["owner", "admin"] },
      { href: "/dasbor/laporan", label: "Laporan", icon: IconChart, roles: ["owner"] },
    ],
  },
  {
    label: "Pengaturan",
    items: [
      {
        href: "/dasbor/operasional",
        label: "Operasional Harian",
        icon: IconCalendar,
        roles: ["owner"],
      },
      { href: "/dasbor/layanan", label: "Layanan & Harga", icon: IconTag, roles: ["owner"] },
      { href: "/dasbor/akun", label: "Akun Petugas", icon: IconUsers, roles: ["owner"] },
      { href: "/dasbor/log", label: "Log Aktivitas", icon: IconHistory, roles: ["owner"] },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  admin: "Admin",
  cashier: "Kasir",
};

function isActive(pathname: string, href: string): boolean {
  return href === "/dasbor" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function AppShell({
  roles,
  children,
  bottomBar,
}: {
  roles: Role[];
  children: ReactNode;
  /** Navigasi bawah khusus halaman, hanya tampil di layar kecil. */
  bottomBar?: ReactNode;
}) {
  const user = useRequireRole(roles);
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const online = useOnline();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (!user) return <ShellSkeleton />;

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => n.roles.includes(user.role)),
  })).filter((g) => g.items.length > 0);
  const current = groups.flatMap((g) => g.items).find((n) => isActive(pathname, n.href));

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Sidebar: rail ikon di tablet landscape, penuh di layar lebar. */}
      <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col bg-nav text-nav-ink print:hidden lg:flex lg:w-[76px] xl:w-[248px]">
        <div className="flex h-16 items-center gap-2.5 px-5 lg:justify-center xl:justify-start">
          <BrandMark size={32} />
          <div className="hidden leading-tight xl:block">
            <p className="text-[15px] font-semibold text-white">Gedklin</p>
            <p className="text-xs text-nav-faint">Laundry · Medan</p>
          </div>
        </div>
        <NavList groups={groups} pathname={pathname} variant="sidebar" />
        <SidebarFooter user={user} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar untuk HP dan tablet portrait. */}
        <header className="pt-safe sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur print:hidden lg:hidden">
          <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-2 hover:bg-canvas"
              aria-label="Buka menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <IconMenu size={22} />
            </button>
            <BrandMark size={28} />
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
              {current?.label ?? "Gedklin"}
            </p>
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-[13px] font-semibold text-brand-700"
              title={`${user.name} (${ROLE_LABEL[user.role]})`}
            >
              {initials(user.name)}
            </span>
          </div>
        </header>

        {!online && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 bg-warn-50 px-4 py-2 text-[13px] font-medium text-warn-700 print:hidden"
          >
            <IconWifiOff size={16} />
            Perangkat sedang offline. Data tidak bisa disimpan sampai koneksi kembali.
          </div>
        )}

        <main
          className={`mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8 ${
            bottomBar ? "pb-28 lg:pb-8" : ""
          }`}
        >
          {children}
        </main>
      </div>

      {bottomBar && (
        <nav
          aria-label="Navigasi kasir"
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur print:hidden lg:hidden"
        >
          {bottomBar}
        </nav>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Tutup menu"
            className="absolute inset-0 bg-nav/50 animate-[fade-in_150ms_ease-out]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="pt-safe pb-safe relative flex h-full w-[288px] max-w-[85vw] flex-col bg-nav text-nav-ink shadow-pop animate-[drawer-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
            <div className="flex h-16 items-center gap-2.5 pl-5 pr-2">
              <BrandMark size={32} />
              <div className="flex-1 leading-tight">
                <p className="text-[15px] font-semibold text-white">Gedklin</p>
                <p className="text-xs text-nav-faint">Laundry · Medan</p>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-nav-ink hover:bg-nav-2"
                onClick={() => setDrawerOpen(false)}
              >
                <IconX size={20} />
              </button>
            </div>
            <NavList
              groups={groups}
              pathname={pathname}
              variant="drawer"
              onNavigate={() => setDrawerOpen(false)}
            />
            <SidebarFooter user={user} expanded />
          </div>
        </div>
      )}
    </div>
  );
}

function NavList({
  groups,
  pathname,
  variant,
  onNavigate,
}: {
  groups: { label: string; items: NavItem[] }[];
  pathname: string;
  variant: "sidebar" | "drawer";
  onNavigate?: () => void;
}) {
  const rail = variant === "sidebar";
  return (
    <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 py-2">
      {groups.map((g) => (
        <div key={g.label} className="mb-5">
          <p
            className={`mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-nav-faint ${
              rail ? "hidden xl:block" : ""
            }`}
          >
            {g.label}
          </p>
          {rail && <div className="mx-auto mb-2 h-px w-8 bg-nav-2 xl:hidden" aria-hidden="true" />}
          <ul className="space-y-0.5">
            {g.items.map((n) => {
              const active = isActive(pathname, n.href);
              const Icon = n.icon;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={rail ? n.label : undefined}
                    className={`group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                      rail ? "lg:justify-center xl:justify-start" : ""
                    } ${
                      active
                        ? "bg-brand-600 text-white"
                        : "text-nav-ink hover:bg-nav-2 hover:text-white"
                    }`}
                  >
                    <Icon size={20} className="shrink-0" />
                    <span className={rail ? "hidden xl:inline" : ""}>{n.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ user, expanded = false }: { user: User; expanded?: boolean }) {
  const { logout } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const router = useRouter();
  const { canInstall, install } = useInstallPrompt();
  const wide = expanded ? "" : "hidden xl:block";

  return (
    <div className="border-t border-nav-2 p-3">
      {canInstall && (
        <button
          type="button"
          onClick={install}
          title="Pasang aplikasi"
          aria-label="Pasang aplikasi"
          className={`mb-2 flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-nav-ink hover:bg-nav-2 hover:text-white ${
            expanded ? "" : "lg:justify-center xl:justify-start"
          }`}
        >
          <IconDownload size={20} className="shrink-0" />
          <span className={wide}>Pasang aplikasi</span>
        </button>
      )}
      <div
        className={`flex items-center gap-3 ${expanded ? "" : "lg:flex-col lg:gap-2 xl:flex-row xl:gap-3"}`}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nav-2 text-[13px] font-semibold text-white"
          title={`${user.name} (${ROLE_LABEL[user.role]})`}
        >
          {initials(user.name)}
        </span>
        <div className={`min-w-0 flex-1 leading-tight ${wide}`}>
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="text-xs text-nav-faint">{ROLE_LABEL[user.role]}</p>
        </div>
        <button
          type="button"
          aria-label="Ganti password"
          title="Ganti password"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-nav-faint hover:bg-nav-2 hover:text-white"
          onClick={() => setChangingPassword(true)}
        >
          <IconKey size={18} />
        </button>
        <button
          type="button"
          aria-label="Keluar"
          title="Keluar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-nav-faint hover:bg-nav-2 hover:text-white"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          <IconLogOut size={18} />
        </button>
      </div>
      <ChangePasswordModal open={changingPassword} onClose={() => setChangingPassword(false)} />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh bg-canvas" aria-busy="true">
      <span className="sr-only">Memuat...</span>
      <div className="hidden h-dvh bg-nav lg:block lg:w-[76px] xl:w-[248px]" />
      <div className="flex-1 space-y-4 p-8">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-4 w-80 max-w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    </div>
  );
}
