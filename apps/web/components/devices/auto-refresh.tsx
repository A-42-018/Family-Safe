"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { startAutoRefresh } from "@/lib/devices/auto-refresh";

/** Renders nothing; re-fetches the current server-rendered page every minute while the tab is visible. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(
    () => startAutoRefresh({ refresh: () => router.refresh(), doc: document, timers: { setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (h) => window.clearInterval(h as number) } }),
    [router],
  );
  return null;
}
