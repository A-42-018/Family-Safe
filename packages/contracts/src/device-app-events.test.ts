import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_EVENT_EDGE_MARGIN_SECONDS,
  APP_EVENT_FUTURE_SECONDS,
  APP_EVENT_PAST_SECONDS,
  APP_EVENT_TIME_PATTERN,
  APP_EVENT_TYPES,
  DEVICE_APP_EVENTS_MAX,
  appEventSchema,
  deviceAppEventsRequestSchema,
  deviceAppEventsResponseSchema,
  isAppEventTimeInRange,
  parseAppEventTime,
} from "./device-app-events";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ev = (o: Record<string, unknown> = {}) => ({
  type: "BLOCKED_APP_ATTEMPT",
  package_name: "com.example.game",
  occurred_at: "2026-10-01T11:58:00Z",
  ...o,
});
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("constants", () => {
  it("match the plan", () => {
    expect(APP_EVENT_TYPES).toEqual(["BLOCKED_APP_ATTEMPT"]);
    expect(DEVICE_APP_EVENTS_MAX).toBe(20);
    expect(APP_EVENT_PAST_SECONDS).toBe(86_400);
    expect(APP_EVENT_FUTURE_SECONDS).toBe(300);
    expect(APP_EVENT_EDGE_MARGIN_SECONDS).toBe(60);
  });
});

describe("parseAppEventTime", () => {
  it("accepts UTC times with 0 to 9 fraction digits and truncates to milliseconds", () => {
    expect(parseAppEventTime("2026-10-01T12:00:00Z")).toBe(NOW);
    expect(parseAppEventTime("2026-10-01T12:00:00.1Z")).toBe(NOW + 100);
    expect(parseAppEventTime("2026-10-01T12:00:00.123Z")).toBe(NOW + 123);
    expect(parseAppEventTime("2026-10-01T12:00:00.123456789Z")).toBe(NOW + 123);
    expect(parseAppEventTime("2026-10-01T12:00:00.0009Z")).toBe(NOW);
  });
  it("rejects offsets, missing parts, lowercase, whitespace and over-long fractions", () => {
    for (const v of [
      "2026-10-01T12:00:00+00:00", "2026-10-01T12:00:00", "2026-10-01 12:00:00Z", "2026-10-01T12:00Z",
      "2026-10-01T12:00:00.Z", "2026-10-01T12:00:00.1234567890Z", "2026-10-01t12:00:00z", " 2026-10-01T12:00:00Z",
      "2026-10-01T12:00:00Z ", "", "yesterday", "2026-10-01T12:00:00ZZ",
    ]) expect(parseAppEventTime(v), JSON.stringify(v)).toBeNull();
  });
  it("rejects impossible calendar dates and clock values", () => {
    for (const v of [
      "2026-02-30T12:00:00Z", "2026-13-01T12:00:00Z", "2026-00-10T12:00:00Z", "2026-04-31T12:00:00Z",
      "2026-10-01T24:00:00Z", "2026-10-01T12:60:00Z", "2026-10-01T12:00:60Z",
    ]) expect(parseAppEventTime(v), v).toBeNull();
    expect(parseAppEventTime("2028-02-29T00:00:00Z")).not.toBeNull();
    expect(parseAppEventTime("2027-02-29T00:00:00Z")).toBeNull();
  });
});

describe("isAppEventTimeInRange (narrowed window)", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const past = (APP_EVENT_PAST_SECONDS - APP_EVENT_EDGE_MARGIN_SECONDS) * 1000;
  const future = (APP_EVENT_FUTURE_SECONDS - APP_EVENT_EDGE_MARGIN_SECONDS) * 1000;
  it("accepts exactly the narrowed boundaries and nothing beyond", () => {
    expect(isAppEventTimeInRange(iso(NOW - past), NOW)).toBe(true);
    expect(isAppEventTimeInRange(iso(NOW - past - 1000), NOW)).toBe(false);
    expect(isAppEventTimeInRange(iso(NOW + future), NOW)).toBe(true);
    expect(isAppEventTimeInRange(iso(NOW + future + 1000), NOW)).toBe(false);
  });
  it("the Edge window is strictly inside the SQL window on both sides", () => {
    expect(past).toBeLessThan(APP_EVENT_PAST_SECONDS * 1000);
    expect(future).toBeLessThan(APP_EVENT_FUTURE_SECONDS * 1000);
  });
  it("an unparseable time is never in range", () => {
    expect(isAppEventTimeInRange("nope", NOW)).toBe(false);
  });
});

describe("appEventSchema", () => {
  it("accepts a valid event", () => {
    expect(appEventSchema.safeParse(ev()).success).toBe(true);
  });
  it("rejects other types, bad packages, bad times, extra keys and missing keys", () => {
    for (const bad of [
      ev({ type: "APP_INSTALLED" }), ev({ type: "blocked_app_attempt" }), ev({ type: undefined }),
      ev({ package_name: "nodots" }), ev({ package_name: "com..x" }), ev({ package_name: "1com.x" }),
      ev({ package_name: `com.${"a".repeat(260)}` }), ev({ package_name: 5 }),
      ev({ occurred_at: "2026-10-01T11:58:00+00:00" }), ev({ occurred_at: 1759319880 }), ev({ occurred_at: null }),
      ev({ occurred_at: `2026-10-01T11:58:00.${"1".repeat(40)}Z` }),
      { ...ev(), app_name: "Game" }, { ...ev(), device_id: "d0000000-0000-4000-8000-0000000000aa" },
      { type: "BLOCKED_APP_ATTEMPT", package_name: "com.example.game" },
    ]) expect(appEventSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("deviceAppEventsRequestSchema", () => {
  it("accepts 1 to 20 events", () => {
    expect(deviceAppEventsRequestSchema.safeParse({ events: [ev()] }).success).toBe(true);
    expect(deviceAppEventsRequestSchema.safeParse({ events: Array.from({ length: 20 }, () => ev()) }).success).toBe(true);
  });
  it("rejects empty, 21 events, missing/extra top-level keys and non-arrays", () => {
    for (const bad of [
      { events: [] }, { events: Array.from({ length: 21 }, () => ev()) }, {}, { events: ev() }, { events: "x" },
      { events: [ev()], device_id: "d0000000-0000-4000-8000-0000000000aa" }, { events: [ev(), { ...ev(), extra: 1 }] },
    ]) expect(deviceAppEventsRequestSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
  });
});

describe("deviceAppEventsResponseSchema", () => {
  it("is just the server time (never says what was stored or ignored)", () => {
    expect(deviceAppEventsResponseSchema.safeParse({ server_time: "2026-10-01T12:00:00.000Z" }).success).toBe(true);
    expect(deviceAppEventsResponseSchema.safeParse({ server_time: "2026-10-01T12:00:00.000Z", recorded: 1 }).success).toBe(false);
    expect(deviceAppEventsResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("Edge Function mirror (supabase/functions/_shared/device-app-events.ts) has not drifted", () => {
  const edge = read("../../../supabase/functions/_shared/device-app-events.ts");
  const own = read("./device-app-events.ts");
  const body = (src: string, name: string) => {
    const start = src.indexOf(`export function ${name}`);
    expect(start, name).toBeGreaterThan(-1);
    const end = src.indexOf("\n}\n", start);
    return src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  };
  it("constants are identical", () => {
    for (const [name, value] of [
      ["DEVICE_APP_EVENTS_MAX", "20"], ["APP_EVENT_PAST_SECONDS", "86_400"], ["APP_EVENT_FUTURE_SECONDS", "300"],
      ["APP_EVENT_EDGE_MARGIN_SECONDS", "60"],
    ] as const) expect(edge).toContain(`export const ${name} = ${value};`);
    expect(edge).toContain('export const APP_EVENT_TYPES = ["BLOCKED_APP_ATTEMPT"] as const;');
  });
  it("the time pattern has the same source", () => {
    const m = /export const APP_EVENT_TIME_PATTERN = (\/.*\/);/.exec(edge);
    expect(m?.[1]).toBe(String(APP_EVENT_TIME_PATTERN));
  });
  it("the time parser and range check have identical bodies", () => {
    expect(body(edge, "parseAppEventTime")).toBe(body(own, "parseAppEventTime"));
    expect(body(edge, "isAppEventTimeInRange")).toBe(body(own, "isAppEventTimeInRange"));
  });
  it("the schema rules are the same (strict, 1..20, package, time)", () => {
    for (const frag of [
      "type: z.enum(APP_EVENT_TYPES)", "package_name: z.string().max(255).regex(PACKAGE_NAME_PATTERN)",
      'occurred_at: z.string().max(40).refine((v) => parseAppEventTime(v) !== null, "invalid time")',
      ".strict()", "events: z.array(", ".min(1).max(DEVICE_APP_EVENTS_MAX)",
    ]) {
      expect(edge, frag).toContain(frag);
      expect(own, frag).toContain(frag);
    }
  });
});

describe("SQL (migration 20260930001700_app_rules.sql) agrees with the contract", () => {
  const sql = read("../../../supabase/migrations/20260930001700_app_rules.sql");
  const fn = sql.slice(sql.indexOf("function public.device_record_app_attempts"));
  it("same event count bounds and event type", () => {
    expect(fn).toContain(`jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > ${DEVICE_APP_EVENTS_MAX}`);
    expect(fn).toContain("'BLOCKED_APP_ATTEMPT'");
  });
  it("same time pattern and window", () => {
    // SQL has no capture groups for the date/time parts; the optional fraction is the only group.
    const body = APP_EVENT_TIME_PATTERN.source.replace(/\((\[0-9\]\{\d\})\)/g, "$1").replace(/\\\//g, "/");
    expect(fn).toContain(`'${body}'`);
    expect(fn).toContain(`now() - interval '${APP_EVENT_PAST_SECONDS / 3600} hours'`);
    expect(fn).toContain(`now() + interval '${APP_EVENT_FUTURE_SECONDS / 60} minutes'`);
  });
  it("same package pattern and length", () => {
    expect(fn).toContain("char_length(v_pkg) > 255");
    expect(fn).toContain("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$");
  });
  it("exactly three keys per event, validated before any row is touched", () => {
    expect(fn).toContain("jsonb_object_keys(e)) <> 3");
    expect(fn.indexOf("invalid event")).toBeLessThan(fn.indexOf("for update of d"));
  });
  it("service_role only, definer, empty search_path", () => {
    expect(sql).toMatch(/revoke all on function public\.device_record_app_attempts\(uuid, jsonb\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.device_record_app_attempts\(uuid, jsonb\) to service_role;/);
    expect(fn.slice(0, 400)).toContain("security definer");
    expect(fn.slice(0, 400)).toContain("set search_path = ''");
  });
  it("never touches liveness columns or the audit log", () => {
    expect(fn).not.toMatch(/last_seen_at|device_status/);
    expect(fn).not.toContain("audit_logs");
  });
});

describe("Edge function wiring", () => {
  const idx = read("../../../supabase/functions/device-app-events/index.ts");
  const handler = read("../../../supabase/functions/device-app-events/handler.ts");
  it("index.ts calls the RPC with the parameter names SQL declares and maps only o_outcome", () => {
    expect(idx).toContain('service.rpc("device_record_app_attempts"');
    expect(idx).toContain("p_device_id: deviceId");
    expect(idx).toContain("p_events: events");
    expect(idx).toContain("o_outcome");
    expect(idx).not.toContain("o_recorded");
    expect(idx).not.toContain("o_ignored");
  });
  it("handler guards with requireActiveDevice and answers only server_time", () => {
    expect(handler).toContain("requireActiveDevice");
    expect(handler).toContain("server_time");
    expect(handler).not.toMatch(/recorded:|ignored:/);
  });
  it("is registered without gateway JWT verification (the handler verifies the device token)", () => {
    const cfg = read("../../../supabase/config.toml");
    expect(cfg).toMatch(/\[functions\.device-app-events\]\s*\n(?:[^\[]*\n)?verify_jwt = false/);
  });
});
