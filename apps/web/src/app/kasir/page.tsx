"use client";

import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconClock, IconList, IconPackageCheck, IconPlusCircle } from "@/components/icons";
import { NewOrderForm } from "@/components/kasir/NewOrderForm";
import { BOARD_TABS, OrderBoard, boardCount, useBoardData, type BoardTab } from "@/components/kasir/OrderBoard";
import { useToast } from "@/components/overlay";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["cashier", "owner"];

const TAB_ICON: Record<BoardTab, typeof IconList> = {
  received: IconList,
  processing: IconClock,
  ready: IconPackageCheck,
};

export default function KasirPage() {
  // HP: satu layar per tugas (nota baru atau salah satu tahap). Tablet/desktop: formulir dan papan berdampingan.
  const [mobileView, setMobileView] = useState<"new" | "board">("new");
  const [tab, setTab] = useState<BoardTab>("received");
  const [refreshKey, setRefreshKey] = useState(0);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const toast = useToast();
  const board = useBoardData(refreshKey);

  const items: { key: "new" | BoardTab; label: string; icon: typeof IconList; count?: number }[] = [
    { key: "new", label: "Baru", icon: IconPlusCircle },
    ...BOARD_TABS.map((t) => ({ key: t.key, label: t.short, icon: TAB_ICON[t.key], count: boardCount(board, t.key) })),
  ];

  return (
    <AppShell
      roles={ROLES}
      bottomBar={
        <ul className="grid grid-cols-4">
          {items.map((it) => {
            const active = it.key === "new" ? mobileView === "new" : mobileView === "board" && tab === it.key;
            const Icon = it.icon;
            return (
              <li key={it.key}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (it.key === "new") setMobileView("new");
                    else {
                      setMobileView("board");
                      setTab(it.key);
                    }
                    window.scrollTo({ top: 0 });
                  }}
                  className={`relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-150 ${
                    active ? "text-brand-700" : "text-muted"
                  }`}
                >
                  {active && <span className="absolute inset-x-5 top-0 h-[3px] bg-brand-600" aria-hidden="true" />}
                  <span className="relative">
                    <Icon size={20} />
                    {!!it.count && (
                      <span className="tabular absolute -right-3.5 -top-1.5 min-w-5 rounded-full bg-brand-600 px-1 text-center text-xs font-semibold leading-[18px] text-white ring-2 ring-surface">
                        {it.count}
                      </span>
                    )}
                  </span>
                  {it.label}
                </button>
              </li>
            );
          })}
        </ul>
      }
    >
      {/* Desktop: tinggi dikunci setinggi layar; form tetap terlihat dan hanya daftar pesanan yang di-scroll. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
        <div
          className={`${mobileView === "new" ? "block" : "hidden"} lg:sticky lg:top-6 lg:-m-1 lg:block lg:max-h-[calc(100dvh-3rem+0.5rem)] lg:overflow-y-auto lg:p-1`}
        >
          <NewOrderForm
            onCreated={(order) => {
              setRefreshKey((k) => k + 1);
              setTab("received");
              setHighlightId(order.id);
              toast(`${order.tracking_code} masuk antrean`);
            }}
          />
        </div>
        <div className={`${mobileView === "board" ? "block" : "hidden"} min-w-0 lg:block`}>
          <OrderBoard
            tab={tab}
            onTabChange={setTab}
            board={board}
            highlightId={highlightId}
            onStatusChanged={(message) => toast(message)}
          />
        </div>
      </div>
    </AppShell>
  );
}
