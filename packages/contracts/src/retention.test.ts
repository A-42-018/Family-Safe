import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OFFLINE_AFTER_SECONDS, RETENTION_DAYS, RETENTION_RESULT_KEYS, RETENTION_SCHEDULE_MINUTES } from "./retention";

const strip = (s: string): string => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const first = strip(readFileSync(new URL("../../../supabase/migrations/20261007000700_retention_jobs.sql", import.meta.url), "utf8"));
/** `retention_run` was re-created by 20a-1 (it also expires commands); the LATEST definition is the one that counts. */
const latest = strip(readFileSync(new URL("../../../supabase/migrations/20261007000800_command_sync.sql", import.meta.url), "utf8"));
const code = latest.slice(latest.indexOf("create or replace function public.retention_run()"));

describe("retention windows", () => {
  it("match the prompt: usage 90 d, audit 180 d, location at most 90 d", () => {
    expect(RETENTION_DAYS.audit_logs).toBe(180);
    expect(RETENTION_DAYS.app_usage_daily).toBe(90);
    expect(RETENTION_DAYS.device_usage_daily).toBe(90);
    expect(RETENTION_DAYS.location_points).toBeLessThanOrEqual(90);
    for (const d of Object.values(RETENTION_DAYS)) expect(d).toBeGreaterThan(0);
  });
});

describe("SQL (migration 20261007000700_retention_jobs.sql) agrees with the contract", () => {
  it("every window in the SQL equals the contract", () => {
    expect(code).toMatch(/delete from public\.device_events where created_at < now\(\) - interval '90 days'/);
    expect(code).toMatch(/delete from public\.app_usage_daily where usage_date < v_today - 90\b/);
    expect(code).toMatch(/delete from public\.device_usage_daily where usage_date < v_today - 90\b/);
    expect(code).toMatch(/delete from public\.location_points where recorded_at < now\(\) - interval '90 days'/);
    expect(code).toMatch(/delete from public\.device_commands where created_at < now\(\) - interval '30 days'/);
    expect(code).toMatch(/delete from public\.device_credentials where expires_at < now\(\) - interval '30 days'/);
    expect(code).toMatch(/delete from public\.pairing_tokens where expires_at < now\(\) - interval '7 days'/);
    expect(RETENTION_DAYS.device_events).toBe(90);
    expect(RETENTION_DAYS.app_usage_daily).toBe(90);
    expect(RETENTION_DAYS.device_commands).toBe(30);
    expect(RETENTION_DAYS.device_credentials).toBe(30);
    expect(RETENTION_DAYS.pairing_tokens).toBe(7);
    // audit (180) and notifications (90) are purged by their own functions; their windows are checked in their migrations
    const audit = readFileSync(new URL("../../../supabase/migrations/20261007000300_audit_log_read.sql", import.meta.url), "utf8");
    const notifications = readFileSync(new URL("../../../supabase/migrations/20261007000400_notifications.sql", import.meta.url), "utf8");
    expect(audit).toContain(`interval '${RETENTION_DAYS.audit_logs} days'`);
    expect(notifications).toContain(`interval '${RETENTION_DAYS.notifications} days'`);
  });
  it("the result keys are exactly the contract's, in order", () => {
    const keys = [...code.matchAll(/jsonb_build_object\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...RETENTION_RESULT_KEYS]);
  });
  it("the sweep and the schedule use the contract's numbers", () => {
    expect(OFFLINE_AFTER_SECONDS).toBe(2700);
    expect(code).toContain("public.device_mark_stale_offline()");
    expect(code).toContain("public.device_commands_expire()");
    expect(readFileSync(new URL("../../../supabase/migrations/20260929001100_heartbeat.sql", import.meta.url), "utf8")).toContain(`p_stale_seconds int default ${OFFLINE_AFTER_SECONDS}`);
    expect(first).toContain(`'*/${RETENTION_SCHEDULE_MINUTES} * * * *'`);
  });
  it("is service_role only, SECURITY DEFINER with an empty search_path, and schedules only when pg_cron already exists", () => {
    expect(code).toMatch(/revoke all on function public\.retention_run\(\) from public, anon, authenticated;/);
    expect(code).toMatch(/grant execute on function public\.retention_run\(\) to service_role;/);
    expect(code).toMatch(/security definer\s+set search_path = ''/);
    expect(first).toContain("to_regprocedure('cron.schedule(text,text,text)') is not null");
    expect(first).not.toMatch(/create extension/i);
  });
});
