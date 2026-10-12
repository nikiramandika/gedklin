"use client";

import { AppShell } from "@/components/AppShell";
import { NewOrderForm } from "@/components/kasir/NewOrderForm";
import { OrderBoard } from "@/components/kasir/OrderBoard";
import { useState } from "react";

import type { Role } from "@/lib/types";

const ROLES: Role[] = ["cashier", "owner"];

export default function KasirPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <AppShell roles={ROLES}>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <NewOrderForm onCreated={() => setRefreshKey((k) => k + 1)} />
        <OrderBoard refreshKey={refreshKey} />
      </div>
    </AppShell>
  );
}
