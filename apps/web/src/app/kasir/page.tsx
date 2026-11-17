"use client";

import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { IconList, IconPackageCheck, IconPlusCircle, IconSearch } from "@/components/icons";
import { NewOrderForm } from "@/components/kasir/NewOrderForm";
import { OrderBoard, useBoardData, type BoardTab } from "@/components/kasir/OrderBoard";
import { useToast } from "@/components/overlay";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["cashier", "owner"];

type View = "new" | BoardTab;

export default function KasirPage() {
  const [view, setView] = useState<View>("new");
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const board = useBoardData(refreshKey);
  const boardTab: BoardTab = view === "new" ? "queue" : view;

  const items: { key: View; label: string; icon: typeof IconList; count?: number }[] = [
    { key: "new", label: "Baru", icon: IconPlusCircle },
    { key: "queue", label: "Antrean", icon: IconList, count: board.queue?.length },
    { key: "ready", label: "Siap", icon: IconPackageCheck, count: board.ready?.length },
    { key: "search", label: "Cari", icon: IconSearch },
  ];

  return (
    <AppShell
      roles={ROLES}
      bottomBar={
        <ul className="grid grid-cols-4">
          {items.map((it) => {
            const active = view === it.key;
            const Icon = it.icon;
            return (
              <li key={it.key}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setView(it.key);
                    window.scrollTo({ top: 0 });
                  }}
                  className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150 ${
                    active ? "text-brand-700" : "text-muted"
                  }`}
                >
                  {active && (
                    <span className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-brand-600" aria-hidden="true" />
                  )}
                  <span className="relative">
                    <Icon size={22} />
                    {!!it.count && (
                      <span className="tabular absolute -right-3 -top-1.5 min-w-5 rounded-full bg-brand-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white ring-2 ring-surface">
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
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <div className={`${view === "new" ? "block" : "hidden"} lg:block`}>
          <NewOrderForm
            onCreated={() => {
              setRefreshKey((k) => k + 1);
              toast("Pesanan tersimpan dan masuk antrean");
            }}
          />
        </div>
        <div className={`${view === "new" ? "hidden" : "block"} min-w-0 lg:block`}>
          <OrderBoard
            tab={boardTab}
            onTabChange={setView}
            queue={board.queue}
            ready={board.ready}
            error={board.error}
            reload={board.reload}
            onStatusChanged={(message) => toast(message)}
          />
        </div>
      </div>
    </AppShell>
  );
}
