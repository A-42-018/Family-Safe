import { describe, expect, it, vi } from "vitest";
import { createAuditRecorder } from "./audit";

const env = { supabaseUrl: "https://p.supabase.co", anonKey: "anon-key" };

describe("audit recorder", () => {
  it("posts LOGIN to the auth-events function with the user's token only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await createAuditRecorder(env, "1.2.3.4", fetchMock as unknown as typeof fetch)({ accessToken: "a.b.c", method: "password" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://p.supabase.co/functions/v1/auth-events");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer a.b.c");
    expect(h.apikey).toBe("anon-key");
    expect(h["x-forwarded-for"]).toBe("1.2.3.4");
    expect(JSON.parse(init.body as string)).toEqual({ event: "LOGIN", method: "password" });
  });
  it("omits x-forwarded-for when the IP is unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await createAuditRecorder(env, "unknown", fetchMock as unknown as typeof fetch)({ accessToken: "a.b.c", method: "mfa_totp" });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty("x-forwarded-for");
  });
  it("throws on non-2xx so callers can log (without leaking the token)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    const p = createAuditRecorder(env, "1.1.1.1", fetchMock as unknown as typeof fetch)({ accessToken: "secret.tok.en", method: "password" });
    await expect(p).rejects.toThrow("audit_http_429");
    await p.catch((e: Error) => expect(e.message).not.toContain("secret"));
  });
});
