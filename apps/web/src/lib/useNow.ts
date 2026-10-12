"use client";

import { useSyncExternalStore } from "react";

// Satu jam bersama untuk semua komponen. Bernilai 0 saat prerender di server,
// sehingga teks relatif ("2 jam lagi") baru muncul setelah hidrasi.
const TICK_MS = 30_000;
let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  if (current === 0) current = Date.now();
  return current;
}

/** Waktu sekarang (ms), diperbarui tiap 30 detik. 0 saat render di server. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
