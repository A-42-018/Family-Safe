import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

describe("csp", () => {
  const prod = buildCsp({ nonce: "abc123", isDev: false, supabaseUrl: "https://proj.supabase.co" });

  it("uses a nonce + strict-dynamic and forbids eval in production", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
  it("locks down framing, plugins, base and forms", () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'", "upgrade-insecure-requests"]) {
      expect(prod).toContain(d);
    }
  });
  it("only allows the configured Supabase origin (https + wss) for connections", () => {
    expect(prod).toContain("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
    expect(prod).not.toContain("*");
  });
  it("dev allows eval for HMR but not in prod", () => {
    const dev = buildCsp({ nonce: "n", isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
  it("does not force https upgrades when Supabase is plain http (local stack)", () => {
    expect(buildCsp({ nonce: "n", isDev: false, supabaseUrl: "http://127.0.0.1:54321" })).not.toContain("upgrade-insecure-requests");
  });
  it("nonces are unique and base64", () => {
    const a = generateNonce();
    expect(a).not.toBe(generateNonce());
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  it("ignores an invalid supabase url instead of throwing", () => {
    expect(buildCsp({ nonce: "n", isDev: false, supabaseUrl: "not a url" })).toContain("connect-src 'self'");
  });
});
