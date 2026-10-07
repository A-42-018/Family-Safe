import { describe, expect, it } from "vitest";
import { decideRedirect, safeNext, type SessionState } from "./routes";

const anon: SessionState = { user: null, aal: { current: null, next: null } };
const authed = (over: Partial<SessionState> = {}): SessionState => ({
  user: { id: "u1", emailConfirmed: true },
  aal: { current: "aal1", next: "aal1" },
  ...over,
});
const needsMfa = authed({ aal: { current: "aal1", next: "aal2" } });
const mfaDone = authed({ aal: { current: "aal2", next: "aal2" } });
const unconfirmed = authed({ user: { id: "u1", emailConfirmed: false } });

describe("safeNext (open redirect defence)", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/devices/abc?tab=usage", "/devices/abc?tab=usage"],
    [undefined, "/dashboard"],
    [null, "/dashboard"],
    ["", "/dashboard"],
  ])("accepts %j", (input, expected) => expect(safeNext(input)).toBe(expected));

  it.each([
    "//evil.com", "///evil.com", "https://evil.com", "http://evil.com/x", "javascript:alert(1)", "/\\evil.com", "\\\\evil.com",
    "/ok\nSet-Cookie: a=b", "/ok\u0000", "evil.com", "/login", "/signup", "/forgot-password", "/auth/confirm", "/mfa", "/verify-email",
    "/" + "a".repeat(600),
  ])("rejects %j", (input) => expect(safeNext(input)).toBe("/dashboard"));

  it("honours a custom fallback", () => expect(safeNext("//evil.com", "")).toBe(""));
});

describe("decideRedirect", () => {
  it("unauthenticated users are sent to /login (with next)", () => {
    expect(decideRedirect("/dashboard", "", anon)).toBe("/login?next=%2Fdashboard");
    expect(decideRedirect("/devices/1", "?tab=a", anon)).toBe("/login?next=%2Fdevices%2F1%3Ftab%3Da");
    expect(decideRedirect("/", "", anon)).toBe("/login");
    expect(decideRedirect("/settings/security", "", anon)).toBe("/login?next=%2Fsettings%2Fsecurity");
    expect(decideRedirect("/reset-password", "", anon)).toBe("/login?next=%2Freset-password");
    expect(decideRedirect("/mfa", "", anon)).toBe("/login");
  });

  it("guest-only pages", () => {
    for (const p of ["/login", "/signup", "/forgot-password"]) {
      expect(decideRedirect(p, "", anon)).toBeNull();
      expect(decideRedirect(p, "", authed())).toBe("/dashboard");
    }
  });

  it("verify-email and /auth/* are always public", () => {
    for (const s of [anon, authed(), unconfirmed, needsMfa]) {
      expect(decideRedirect("/verify-email", "", s)).toBeNull();
      expect(decideRedirect("/auth/confirm", "?token_hash=x", s)).toBeNull();
    }
  });

  it("unverified email cannot reach the app", () => {
    expect(decideRedirect("/dashboard", "", unconfirmed)).toBe("/verify-email");
    expect(decideRedirect("/settings/security", "", unconfirmed)).toBe("/verify-email");
  });

  it("verified users reach the app", () => {
    expect(decideRedirect("/dashboard", "", authed())).toBeNull();
    expect(decideRedirect("/", "", authed())).toBe("/dashboard");
  });

  it("MFA-enrolled users at aal1 must challenge first (incl. password reset)", () => {
    expect(decideRedirect("/dashboard", "", needsMfa)).toBe("/mfa?next=%2Fdashboard");
    expect(decideRedirect("/reset-password", "", needsMfa)).toBe("/mfa?next=%2Freset-password");
    expect(decideRedirect("/", "", needsMfa)).toBe("/mfa");
    expect(decideRedirect("/mfa", "", needsMfa)).toBeNull();
  });

  it("aal2 users pass; /mfa is pointless for users without a factor", () => {
    expect(decideRedirect("/dashboard", "", mfaDone)).toBeNull();
    expect(decideRedirect("/mfa", "", mfaDone)).toBe("/dashboard");
    expect(decideRedirect("/mfa", "", authed())).toBe("/dashboard");
  });
});
