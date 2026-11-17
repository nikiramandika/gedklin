"use client";

import { useSyncExternalStore } from "react";

// 0 saat prerender di server, supaya teks relatif baru muncul setelah hidrasi.
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

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
