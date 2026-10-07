import { describe, expect, it } from "vitest";
import { formatLastSeen } from "@/lib/enrollment/format";
import {
  apiLevelText, formatPatchDate, formatStorageMb, hasReportedInfo, infoUpdatedText, INFO_STALE_SECONDS, isInfoStale, managedModeText, patchAgeDays, patchHint, storageSummary,
} from "./info";

const now = new Date("2026-09-30T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

describe("reported / updated text", () => {
  it("null or unparseable → Not reported yet", () => {
    expect(hasReportedInfo({ infoUpdatedAt: null })).toBe(false);
    expect(hasReportedInfo({ infoUpdatedAt: "garbage" })).toBe(false);
    expect(infoUpdatedText({ infoUpdatedAt: null }, now, formatLastSeen)).toBe("Not reported yet");
    expect(infoUpdatedText({ infoUpdatedAt: "garbage" }, now, formatLastSeen)).toBe("Not reported yet");
  });
  it("uses the shared relative wording", () => {
    expect(infoUpdatedText({ infoUpdatedAt: ago(3 * 3600) }, now, formatLastSeen)).toBe("Updated 3 hours ago");
    expect(infoUpdatedText({ infoUpdatedAt: ago(10) }, now, formatLastSeen)).toBe("Updated just now");
  });
  it("stale after three daily intervals (boundary inclusive of exactly 3 days = fresh)", () => {
    expect(isInfoStale({ infoUpdatedAt: ago(INFO_STALE_SECONDS) }, now)).toBe(false);
    expect(isInfoStale({ infoUpdatedAt: ago(INFO_STALE_SECONDS + 1) }, now)).toBe(true);
    expect(isInfoStale({ infoUpdatedAt: null }, now)).toBe(false);
  });
});

describe("api level / patch date", () => {
  it("api level range 1–99 only", () => {
    expect(apiLevelText(35)).toBe("API level 35");
    for (const v of [null, 0, 100, 3.5, Number.NaN]) expect(apiLevelText(v as number | null)).toBeNull();
  });
  it("formats real dates only", () => {
    expect(formatPatchDate("2026-09-05")).toBe("5 September 2026");
    expect(formatPatchDate("2010-01-01")).toBe("1 January 2010");
    for (const v of [null, "", "2026-02-30", "2009-12-31", "05/09/2026", "2026-9-5"]) expect(formatPatchDate(v)).toBeNull();
  });
});

describe("patch age hint", () => {
  it("age in whole UTC days; future = 0; invalid = null", () => {
    expect(patchAgeDays("2026-09-30", now)).toBe(0);
    expect(patchAgeDays("2026-09-01", now)).toBe(29);
    expect(patchAgeDays("2026-10-05", now)).toBe(0);
    expect(patchAgeDays(null, now)).toBeNull();
    expect(patchAgeDays("nope", now)).toBeNull();
  });
  it("levels at 90 / 180 day boundaries", () => {
    expect(patchHint("2026-07-02", now)).toMatchObject({ days: 90, level: "recent" });
    expect(patchHint("2026-07-01", now)).toMatchObject({ days: 91, level: "aging" });
    expect(patchHint("2026-04-03", now)).toMatchObject({ days: 180, level: "aging" });
    expect(patchHint("2026-04-02", now)).toMatchObject({ days: 181, level: "outdated" });
    expect(patchHint(null, now)).toBeNull();
  });
  it("wording never claims 'secure' or 'vulnerable'", () => {
    for (const d of ["2026-09-01", "2026-06-01", "2025-01-01"]) expect(patchHint(d, now)?.text).not.toMatch(/vulnerab|insecure|safe\b|secure device/i);
  });
});

describe("storage", () => {
  it("MB / GB text", () => {
    expect(formatStorageMb(0)).toBe("0 MB");
    expect(formatStorageMb(512)).toBe("512 MB");
    expect(formatStorageMb(1024)).toBe("1 GB");
    expect(formatStorageMb(12595)).toBe("12.3 GB");
    expect(formatStorageMb(130048)).toBe("127 GB");
    for (const v of [null, -1, Number.NaN, 16777217]) expect(formatStorageMb(v as number | null)).toBeNull();
  });
  it("summary for a consistent pair", () => {
    expect(storageSummary({ storageTotalMb: 102400, storageFreeMb: 25600 })).toEqual({ usedPercent: 75, usedText: "75 GB", freeText: "25 GB", totalText: "100 GB" });
    expect(storageSummary({ storageTotalMb: 1000, storageFreeMb: 0 })?.usedPercent).toBe(100);
    expect(storageSummary({ storageTotalMb: 1000, storageFreeMb: 1000 })?.usedPercent).toBe(0);
  });
  it("inconsistent or missing pair → null (never a made-up bar)", () => {
    const bad: [number | null, number | null][] = [[null, null], [1000, null], [null, 5], [0, 0], [1000, 1001], [1000, -1], [Number.NaN, 1]];
    for (const [t, f] of bad) expect(storageSummary({ storageTotalMb: t, storageFreeMb: f }), `${t}/${f}`).toBeNull();
  });
});

describe("managedModeText (T4)", () => {
  it("true says the app reported it can pause apps, and never claims proof", () => {
    const t = managedModeText(true);
    expect(t.label).toBe("Managed mode (reported)");
    expect(t.detail).toMatch(/pause apps you block or limit/);
    expect(`${t.label} ${t.detail}`).not.toMatch(/\b(secure|safe|protected|guaranteed)\b|cannot be bypassed|locked out|unbreakable/i);
  });
  it("false says it only informs", () => {
    const t = managedModeText(false);
    expect(t.label).toBe("Standard (reported)");
    expect(t.detail).toMatch(/cannot pause other apps/);
    expect(t.detail).not.toMatch(/enforces/i);
  });
  it("null (older app / nothing uploaded) is not reported", () => {
    expect(managedModeText(null).label).toBe("Not reported yet");
  });
});
