"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, inputClass } from "./ui";

export function TrackingForm({ initial = "" }: { initial?: string }) {
  const [code, setCode] = useState(initial);
  const router = useRouter();

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = code.trim().toUpperCase();
        if (clean) router.push(`/lacak/${encodeURIComponent(clean)}`);
      }}
    >
      <input
        className={`${inputClass} font-mono uppercase tracking-widest`}
        placeholder="Kode di nota"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={16}
        autoCapitalize="characters"
        aria-label="Kode pesanan"
      />
      <Button type="submit">Lacak</Button>
    </form>
  );
}
