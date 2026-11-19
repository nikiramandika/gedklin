"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconSearch } from "./icons";
import { Button, inputClass } from "./ui";

export function TrackingForm({ initial = "" }: { initial?: string }) {
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = code.trim().toUpperCase();
        if (!clean) return;
        setBusy(true);
        router.push(`/lacak/${encodeURIComponent(clean)}`);
      }}
    >
      <label className="block">
        <span className="label-caps mb-1.5 block">Kode lacak</span>
        <input
          className={`${inputClass} h-14! text-center font-mono text-2xl! font-semibold uppercase tracking-[0.18em] text-serial placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:normal-case placeholder:tracking-normal`}
          placeholder="Mis. K7Q2MXH4PA"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={16}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </label>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!code.trim()}>
        <IconSearch size={18} />
        Lacak cucian
      </Button>
    </form>
  );
}
