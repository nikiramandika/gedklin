"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";

import { useAuth, useRequireRole } from "@/lib/auth";
import { initials } from "@/lib/format";
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
  IconList,
  IconLogOut,
  IconMenu,
  IconReceipt,
  IconSettings,
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

// Urut dari yang paling sering dipakai: kerja harian, lalu memantau, lalu data yang jarang diubah.
// Yang perlu ditindaklanjuti di atas daftar biasa; Pengaturan selalu paling bawah.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Harian",
    items: [
      { href: "/dasbor", label: "Dasbor", icon: IconDashboard, roles: ["owner"] },
      { href: "/kasir", label: "Kasir", icon: IconReceipt, roles: ["owner", "cashier"] },
      { href: "/antrean", label: "Antrean Cucian", icon: IconList, roles: ["staff"] },
      { href: "/tindak-lanjut", label: "Tindak Lanjut", icon: IconAlert, roles: ["owner", "cashier"] },
      { href: "/pelanggan", label: "Pelanggan", icon: IconUser, roles: ["owner", "cashier"] },
    ],
  },
  {
    label: "Pantau",
    items: [
      { href: "/dasbor/laporan", label: "Laporan", icon: IconChart, roles: ["owner"] },
      { href: "/dasbor/log", label: "Log Aktivitas", icon: IconHistory, roles: ["owner"] },
    ],
  },
  {
    label: "Kelola",
    items: [
      { href: "/dasbor/operasional", label: "Jadwal Outlet", icon: IconCalendar, roles: ["owner"] },
      { href: "/dasbor/layanan", label: "Layanan & Harga", icon: IconTag, roles: ["owner"] },
      { href: "/dasbor/akun", label: "Akun Karyawan", icon: IconUsers, roles: ["owner"] },
      { href: "/pengaturan", label: "Pengaturan", icon: IconSettings, roles: ["owner", "cashier", "staff"] },
    ],
  },
];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  cashier: "Staff Kasir",
  staff: "Staff",
};

function isActive(pathname: string, href: string): boolean {
  return href === "/dasbor" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  roles,
  children,
  bottomBar,
}: {
  roles: Role[];
  children: ReactNode;
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
      <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col bg-nav text-nav-ink print:hidden lg:flex lg:w-[64px] xl:w-[232px]">
        <div className="flex h-14 items-center gap-2.5 px-4 lg:justify-center xl:justify-start">
          <BrandMark size={26} />
          <div className="hidden leading-tight xl:block">
            <p className="text-base font-semibold text-white">Gedklin</p>
            <p className="text-xs text-nav-faint">Laundry · Medan</p>
          </div>
        </div>
        <NavList groups={groups} pathname={pathname} variant="sidebar" />
        <SidebarFooter user={user} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 border-b border-line bg-surface print:hidden lg:hidden">
          <div className="flex h-12 items-center gap-2 px-2 sm:px-4">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-2 hover:bg-subtle"
              aria-label="Buka menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <IconMenu size={20} />
            </button>
            <BrandMark size={24} />
            <p className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
              {current?.label ?? "Gedklin"}
            </p>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-ink-2 ring-1 ring-line"
              title={`${user.name} (${ROLE_LABEL[user.role]})`}
            >
              {initials(user.name)}
            </span>
          </div>
        </header>

        {!online && (
          <div
            role="status"
            className="flex items-center justify-center gap-2 bg-warn-50 px-4 py-2 text-xs font-medium text-warn-700 print:hidden"
          >
            <IconWifiOff size={16} />
            Offline. Perubahan belum bisa disimpan.
          </div>
        )}

        <main
          className={`mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-6 ${
            bottomBar ? "pb-24 lg:pb-6" : ""
          }`}
        >
          {children}
        </main>
      </div>

      {bottomBar && (
        <nav
          aria-label="Navigasi kasir"
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface print:hidden lg:hidden"
        >
          {bottomBar}
        </nav>
      )}

      {drawerOpen && (
        <div className="fixed inset-x-0 top-0 z-50 h-dvh lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Tutup menu"
            className="absolute inset-0 bg-nav/40 animate-[fade-in_150ms_ease-out]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="pt-safe pb-safe relative flex h-dvh w-[280px] max-w-[85vw] flex-col bg-nav text-nav-ink shadow-pop animate-[drawer-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
            <div className="flex h-14 items-center gap-2.5 pl-4 pr-2">
              <BrandMark size={26} />
              <div className="flex-1 leading-tight">
                <p className="text-base font-semibold text-white">Gedklin</p>
                <p className="text-xs text-nav-faint">Laundry · Medan</p>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-nav-ink hover:bg-nav-2"
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
  const navRef = useRef<HTMLElement>(null);
  const scrollKey = `gedklin_nav_scroll_${variant}`;

  // Tiap halaman memasang AppShell baru, jadi posisi gulir menu dipulihkan; menu aktif selalu terlihat.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    try {
      nav.scrollTop = Number(sessionStorage.getItem(scrollKey)) || 0;
    } catch {}
    // Geser hanya daftar menu (bukan halaman) sampai menu aktif terlihat; ulangi bila ukuran menu berubah.
    const revealActive = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const box = nav.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.top < box.top) nav.scrollTop -= box.top - item.top + 8;
      else if (item.bottom > box.bottom) nav.scrollTop += item.bottom - box.bottom + 8;
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname, scrollKey]);

  return (
    <nav
      ref={navRef}
      aria-label="Navigasi utama"
      className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-2"
      onScroll={(e) => {
        try {
          sessionStorage.setItem(scrollKey, String(e.currentTarget.scrollTop));
        } catch {}
      }}
    >
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <p className={`mb-1 px-2.5 text-xs font-medium text-nav-faint ${rail ? "hidden xl:block" : ""}`}>
            {g.label}
          </p>
          {rail && <div className="mx-auto mb-2 h-px w-6 bg-nav-2 xl:hidden" aria-hidden="true" />}
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
                    className={`group flex h-10 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors duration-150 pointer-coarse:h-11 ${
                      rail ? "lg:justify-center xl:justify-start" : ""
                    } ${active ? "bg-brand-600 text-white" : "text-nav-ink hover:bg-nav-2 hover:text-white"}`}
                  >
                    <Icon size={18} className="shrink-0" />
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
    <div className="border-t border-nav-2 p-2.5">
      {canInstall && (
        <button
          type="button"
          onClick={install}
          title="Pasang aplikasi"
          aria-label="Pasang aplikasi"
          className={`mb-1 flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-base font-medium text-nav-ink hover:bg-nav-2 hover:text-white pointer-coarse:h-11 ${
            expanded ? "" : "lg:justify-center xl:justify-start"
          }`}
        >
          <IconDownload size={17} className="shrink-0" />
          <span className={wide}>Pasang aplikasi</span>
        </button>
      )}
      <div
        className={`flex items-center gap-2 px-1 ${expanded ? "" : "lg:flex-col lg:gap-1.5 xl:flex-row xl:gap-2"}`}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nav-2 text-xs font-semibold text-white"
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nav-faint hover:bg-nav-2 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={() => setChangingPassword(true)}
        >
          <IconKey size={16} />
        </button>
        <button
          type="button"
          aria-label="Keluar"
          title="Keluar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-nav-faint hover:bg-nav-2 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          <IconLogOut size={16} />
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
      <div className="hidden h-dvh bg-nav lg:block lg:w-[64px] xl:w-[232px]" />
      <div className="flex-1 space-y-4 p-8">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-4 w-80 max-w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    </div>
  );
}
