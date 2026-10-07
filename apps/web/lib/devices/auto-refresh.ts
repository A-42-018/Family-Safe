// Live-ish updates without a browser token (Phase 6 decision): re-render Server Components on an interval,
// paused while the tab is hidden. Pure so it can be tested with fakes; the React wrapper is components/devices/auto-refresh.tsx.
export const REFRESH_INTERVAL_MS = 60_000;

export interface VisibilityDoc {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
}
export interface Timers {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Starts refreshing; returns `stop()` (idempotent). Becoming visible again refreshes once immediately. */
export function startAutoRefresh(opts: { refresh: () => void; doc: VisibilityDoc; timers: Timers; intervalMs?: number }): () => void {
  const { refresh, doc, timers, intervalMs = REFRESH_INTERVAL_MS } = opts;
  let handle: unknown = null;
  let stopped = false;
  const start = () => { if (handle === null) handle = timers.setInterval(refresh, intervalMs); };
  const pause = () => { if (handle !== null) { timers.clearInterval(handle); handle = null; } };
  const onVisibility = () => {
    if (stopped) return;
    if (doc.hidden) pause();
    else { refresh(); start(); }
  };
  doc.addEventListener("visibilitychange", onVisibility);
  if (!doc.hidden) start();
  return () => {
    if (stopped) return;
    stopped = true;
    pause();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
