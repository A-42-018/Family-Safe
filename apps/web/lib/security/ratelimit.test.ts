import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, getClientIp, resetRateLimits } from "./ratelimit";

const rule = { name: "t", limit: 2, windowSeconds: 10 };
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

describe("rate limiter", () => {
  beforeEach(resetRateLimits);

  it("blocks after the limit and reports retry-after", () => {
    expect(checkRateLimit(rule, "ip", 0).allowed).toBe(true);
    expect(checkRateLimit(rule, "ip", 1).allowed).toBe(true);
    const r = checkRateLimit(rule, "ip", 2);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
  it("resets after the window and isolates keys/rules", () => {
    for (let i = 0; i < 3; i++) checkRateLimit(rule, "ip", 0);
    expect(checkRateLimit(rule, "ip", 10_001).allowed).toBe(true);
    expect(checkRateLimit(rule, "other", 0).allowed).toBe(true);
    expect(checkRateLimit({ ...rule, name: "u" }, "ip", 0).allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("uses first x-forwarded-for hop, then x-real-ip, then unknown", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(getClientIp(headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(getClientIp(headers({}))).toBe("unknown");
  });
});
