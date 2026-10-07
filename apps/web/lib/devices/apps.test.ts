import { DEVICE_APPS_INTERVAL_SECONDS, DEVICE_APPS_MAX } from "@familysafe/contracts";
import { describe, expect, it } from "vitest";
import { formatLastSeen } from "@/lib/enrollment/format";
import {
  APP_COLUMNS,
  APPS_CAP_NOTE,
  APPS_SEARCH_MAX,
  APPS_STALE_SECONDS,
  appCounts,
  appsUpdatedText,
  areAppsStale,
  asAppRow,
  filterApps,
  hasReportedApps,
  parseAppsQuery,
  resultsText,
  sortApps,
  type AppRow,
} from "./apps";

const NOW = new Date("2026-10-01T12:00:00Z");
const app = (packageName: string, label: string, o: Partial<AppRow> = {}): AppRow => ({ packageName, label, versionName: "1.0", isSystem: false, ...o });
const SAMPLE = [
  app("com.example.chat", "Chat"),
  app("com.android.settings", "Settings", { isSystem: true }),
  app("com.example.zoo", "zoo Map"),
  app("com.example.alpha", "Álpha Game"),
  app("com.google.android.gm", "Gmail", { isSystem: true }),
];

describe("columns", () => {
  it("are exactly the four reported fields, no ids or secrets", () => {
    expect(APP_COLUMNS.split(",")).toEqual(["package_name", "label", "version_name", "is_system"]);
    expect(APP_COLUMNS).not.toMatch(/fcm|token|credential|hash|refresh|device_id/i);
  });
});

describe("asAppRow", () => {
  it("maps a valid row", () => {
    expect(asAppRow({ package_name: "com.a.b", label: "A", version_name: "2.1", is_system: true })).toEqual({ packageName: "com.a.b", label: "A", versionName: "2.1", isSystem: true });
  });
  it("keeps an unknown version as null and a missing/odd system flag as false", () => {
    expect(asAppRow({ package_name: "com.a.b", label: "A", version_name: null, is_system: "yes" })).toEqual({ packageName: "com.a.b", label: "A", versionName: null, isSystem: false });
    expect(asAppRow({ package_name: "com.a.b", label: "A", version_name: "", is_system: false })?.versionName).toBeNull();
  });
  it("skips unusable rows", () => {
    for (const bad of [null, undefined, 5, "x", {}, { package_name: "", label: "A" }, { package_name: "com.a.b", label: "  " }, { package_name: 3, label: "A" }, { package_name: "com.a.b", label: null }]) {
      expect(asAppRow(bad)).toBeNull();
    }
  });
});

describe("parseAppsQuery", () => {
  it("defaults to no search and all apps", () => {
    expect(parseAppsQuery({})).toEqual({ q: "", kind: "all" });
  });
  it("trims, drops control characters and takes the first of repeated params", () => {
    expect(parseAppsQuery({ q: "  cha\u0000t\n ", kind: "user" })).toEqual({ q: "cha t", kind: "user" });
    expect(parseAppsQuery({ q: ["one", "two"], kind: ["system", "user"] })).toEqual({ q: "one", kind: "system" });
  });
  it("unknown kinds (including prototype keys) fall back to all", () => {
    for (const k of ["", "USER", "__proto__", "constructor", "admin"]) expect(parseAppsQuery({ kind: k }).kind).toBe("all");
  });
  it("caps the search text by characters without splitting a surrogate pair", () => {
    const q = parseAppsQuery({ q: "😀".repeat(APPS_SEARCH_MAX + 20) }).q;
    expect(Array.from(q)).toHaveLength(APPS_SEARCH_MAX);
    expect(q).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe("filterApps / sortApps", () => {
  it("matches label or package name, case-insensitively", () => {
    expect(filterApps(SAMPLE, { q: "CHAT", kind: "all" }).map((a) => a.label)).toEqual(["Chat"]);
    expect(filterApps(SAMPLE, { q: "android", kind: "all" }).map((a) => a.label).sort()).toEqual(["Gmail", "Settings"]);
  });
  it("applies the user/system filter together with the search", () => {
    expect(filterApps(SAMPLE, { q: "", kind: "system" }).every((a) => a.isSystem)).toBe(true);
    expect(filterApps(SAMPLE, { q: "", kind: "user" })).toHaveLength(3);
    expect(filterApps(SAMPLE, { q: "settings", kind: "user" })).toEqual([]);
  });
  it("treats the search as plain text, not a pattern", () => {
    expect(filterApps(SAMPLE, { q: ".*", kind: "all" })).toEqual([]);
    expect(filterApps([app("com.a.b", "C++ (Lite)")], { q: "c++ (", kind: "all" })).toHaveLength(1);
  });
  it("sorts by label ignoring case and accents, then package; does not mutate", () => {
    const copy = [...SAMPLE];
    expect(sortApps(SAMPLE).map((a) => a.label)).toEqual(["Álpha Game", "Chat", "Gmail", "Settings", "zoo Map"]);
    expect(SAMPLE).toEqual(copy);
    expect(sortApps([app("com.b.b", "X"), app("com.a.a", "x")]).map((a) => a.packageName)).toEqual(["com.a.a", "com.b.b"]);
  });
});

describe("counts and texts", () => {
  it("counts user and system apps", () => {
    expect(appCounts(SAMPLE)).toEqual({ total: 5, user: 3, system: 2 });
    expect(appCounts([])).toEqual({ total: 0, user: 0, system: 0 });
  });
  it("results line", () => {
    expect(resultsText(0, 0)).toBe("No apps reported");
    expect(resultsText(0, 4)).toBe("No apps match");
    expect(resultsText(4, 4)).toBe("4 apps");
    expect(resultsText(1, 1)).toBe("1 app");
    expect(resultsText(2, 4)).toBe("2 of 4 apps");
  });
});

describe("report time", () => {
  it("nothing is claimed before the first report; an empty report still counts", () => {
    expect(hasReportedApps({ syncedAt: null })).toBe(false);
    expect(hasReportedApps({ syncedAt: "garbage" })).toBe(false);
    expect(hasReportedApps({ syncedAt: "2026-10-01T11:00:00Z" })).toBe(true);
    expect(appsUpdatedText({ syncedAt: null }, NOW, formatLastSeen)).toBe("Not reported yet");
    expect(appsUpdatedText({ syncedAt: "2026-10-01T09:00:00Z" }, NOW, formatLastSeen)).toBe("Updated 3 hours ago");
  });
  it("is stale only after three missed daily syncs (boundary exact)", () => {
    expect(APPS_STALE_SECONDS).toBe(DEVICE_APPS_INTERVAL_SECONDS * 3);
    const at = (age: number) => new Date(NOW.getTime() - age * 1000).toISOString();
    expect(areAppsStale({ syncedAt: at(APPS_STALE_SECONDS) }, NOW)).toBe(false);
    expect(areAppsStale({ syncedAt: at(APPS_STALE_SECONDS + 1) }, NOW)).toBe(true);
    expect(areAppsStale({ syncedAt: null }, NOW)).toBe(false);
    expect(areAppsStale({ syncedAt: "2026-10-01T13:00:00Z" }, NOW)).toBe(false); // future = skew
  });
  it("cap note uses the contract limit", () => {
    expect(APPS_CAP_NOTE).toContain(String(DEVICE_APPS_MAX));
  });
});
