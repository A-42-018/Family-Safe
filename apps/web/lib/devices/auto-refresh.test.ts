import { describe, expect, it } from "vitest";
import { REFRESH_INTERVAL_MS, startAutoRefresh, type Timers, type VisibilityDoc } from "./auto-refresh";

function fakes(hidden = false) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_t: "visibilitychange", cb: () => void) => void listeners.add(cb),
    removeEventListener: (_t: "visibilitychange", cb: () => void) => void listeners.delete(cb),
  } satisfies VisibilityDoc;
  const intervals = new Map<number, () => void>();
  let next = 1;
  const timers: Timers = {
    setInterval: (cb) => { intervals.set(next, cb); return next++; },
    clearInterval: (h) => void intervals.delete(h as number),
  };
  const tick = () => [...intervals.values()].forEach((cb) => cb());
  const setHidden = (h: boolean) => { doc.hidden = h; [...listeners].forEach((cb) => cb()); };
  return { doc, timers, intervals, listeners, tick, setHidden };
}

describe("startAutoRefresh", () => {
  it("defaults to 60 s", () => expect(REFRESH_INTERVAL_MS).toBe(60_000));
  it("refreshes on every tick while visible", () => {
    const f = fakes(); let n = 0;
    startAutoRefresh({ refresh: () => n++, doc: f.doc, timers: f.timers });
    f.tick(); f.tick();
    expect(n).toBe(2);
  });
  it("does not start a timer for a hidden tab and starts one (with an immediate refresh) when it becomes visible", () => {
    const f = fakes(true); let n = 0;
    startAutoRefresh({ refresh: () => n++, doc: f.doc, timers: f.timers });
    expect(f.intervals.size).toBe(0);
    f.setHidden(false);
    expect(n).toBe(1);
    expect(f.intervals.size).toBe(1);
  });
  it("pauses while hidden and never stacks timers", () => {
    const f = fakes(); let n = 0;
    startAutoRefresh({ refresh: () => n++, doc: f.doc, timers: f.timers });
    f.setHidden(true);
    expect(f.intervals.size).toBe(0);
    f.setHidden(false); f.setHidden(false);
    expect(f.intervals.size).toBe(1);
  });
  it("stop() clears the timer, removes the listener and is idempotent", () => {
    const f = fakes(); let n = 0;
    const stop = startAutoRefresh({ refresh: () => n++, doc: f.doc, timers: f.timers });
    stop(); stop();
    expect(f.intervals.size).toBe(0);
    expect(f.listeners.size).toBe(0);
    f.setHidden(false);
    expect(n).toBe(0);
  });
  it("honours a custom interval", () => {
    const f = fakes(); let ms = 0;
    startAutoRefresh({ refresh: () => {}, doc: f.doc, timers: { ...f.timers, setInterval: (cb, m) => { ms = m; return f.timers.setInterval(cb, m); } }, intervalMs: 5000 });
    expect(ms).toBe(5000);
  });
});
