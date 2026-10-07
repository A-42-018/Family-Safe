import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicEnv } from "./env";

afterEach(() => vi.unstubAllEnvs());

describe("getPublicEnv", () => {
  it("parses valid config and defaults the app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getPublicEnv().supabaseUrl).toBe("http://127.0.0.1:54321");
  });
  it("names missing variables but never echoes values", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "SECRET-not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    let msg = "";
    try { getPublicEnv(); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(msg).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(msg).not.toContain("SECRET");
  });
});
