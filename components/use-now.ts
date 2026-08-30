"use client";

import { useSyncExternalStore } from "react";

// A coarse clock (one-minute ticks) that is safe to read during render. The
// React Compiler purity rule forbids Date.now() inside render, and a value
// taken on the server would not match the client, so the time lives in a
// tiny external store: the server snapshot is null (SSR and hydration agree),
// the client snapshot is the store's value, refreshed every minute while
// anyone subscribes.
let nowMs = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      nowMs = Date.now();
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Current time for display decisions (deadline checks); null during SSR and hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => nowMs,
    () => null,
  );
}
