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
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Kode lacak</span>
        <input
          className={`${inputClass.replace("h-11", "h-13").replace("text-base", "text-xl")} text-center font-mono uppercase tracking-[0.2em] placeholder:font-sans placeholder:text-base placeholder:normal-case placeholder:tracking-normal`}
          placeholder="Contoh: K7Q2MXH4PA"
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
