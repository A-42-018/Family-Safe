import { describe, expect, it } from "vitest";
import { ageFromDob, deviceCountLabel, formatAge, initials } from "./format";

const NOW = new Date("2026-09-29T12:00:00Z");

describe("ageFromDob", () => {
  it("counts whole years", () => {
    expect(ageFromDob("2016-09-29", NOW)).toBe(10); // birthday today
    expect(ageFromDob("2016-09-30", NOW)).toBe(9); // tomorrow
    expect(ageFromDob("2016-01-01", NOW)).toBe(10);
    expect(ageFromDob("2026-01-01", NOW)).toBe(0);
  });
  it("null for missing, malformed or future", () => {
    expect(ageFromDob(null, NOW)).toBeNull();
    expect(ageFromDob(undefined, NOW)).toBeNull();
    expect(ageFromDob("", NOW)).toBeNull();
    expect(ageFromDob("nope", NOW)).toBeNull();
    expect(ageFromDob("2030-01-01", NOW)).toBeNull();
    expect(ageFromDob("1800-01-01", NOW)).toBeNull();
  });
});

describe("formatAge / initials / deviceCountLabel", () => {
  it("formats ages", () => {
    expect(formatAge(null)).toBe("Age not set");
    expect(formatAge(0)).toBe("Under 1 year old");
    expect(formatAge(1)).toBe("1 year old");
    expect(formatAge(9)).toBe("9 years old");
  });
  it("initials", () => {
    expect(initials("sam lee")).toBe("SL");
    expect(initials("Sam")).toBe("S");
    expect(initials("  Ana  María  Ruiz ")).toBe("AR");
    expect(initials("   ")).toBe("?");
  });
  it("device count", () => {
    expect(deviceCountLabel(0)).toBe("No devices yet");
    expect(deviceCountLabel(1)).toBe("1 device");
    expect(deviceCountLabel(3)).toBe("3 devices");
  });
});
