import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/ratelimit";
import { CREATED_MESSAGE, FIELD, INACTIVE_MESSAGE, LIMIT_MESSAGE, OVERLAP_MESSAGE, SCHEDULE_GONE_MESSAGE, TIMEZONE_UNKNOWN_MESSAGE, UNCHANGED_MESSAGE } from "./schedules";
import * as svc from "./service";

const UID = "11111111-1111-4111-8111-111111111111";
const DEV = "44444444-4444-4444-8444-444444444444";
const SCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type Err = { code?: string } | null;

/** Only `auth` and `rpc` exist: any table access (`from`) would throw, which proves nothing is written directly. */
function fake(o: { user?: { id: string } | null; rpc?: { data?: unknown; error?: Err } } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameters type the recorded calls
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: o.rpc && "data" in o.rpc ? o.rpc.data : [{ o_outcome: "created" }], error: o.rpc?.error ?? null }));
  const getUser = vi.fn().mockResolvedValue(o.user === null ? { data: { user: null }, error: { message: "x" } } : { data: { user: o.user ?? { id: UID } }, error: null });
  return { deps: { supabase: { auth: { getUser }, rpc } as unknown as SupabaseClient } as svc.ScheduleDeps, rpc, getUser };
}
const outcome = (o: string) => ({ rpc: { data: [{ o_outcome: o }] } });
const form = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  [FIELD.deviceId]: DEV, [FIELD.scheduleId]: "", [FIELD.name]: "Bedtime", [FIELD.type]: "BEDTIME", [FIELD.start]: "21:00", [FIELD.end]: "07:00", [FIELD.enabled]: "on", [FIELD.day(1)]: "on", ...over,
});

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetRateLimits();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveSchedule", () => {
  it("validates before auth and calls only the RPC with the contract values", async () => {
    const f = fake();
    expect(await svc.saveSchedule(f.deps, form({ [FIELD.deviceId]: "nope" }))).toMatchObject({ ok: false, notFound: true });
    expect(await svc.saveSchedule(f.deps, form({ [FIELD.name]: " " }))).toMatchObject({ ok: false });
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    await svc.saveSchedule(f.deps, form());
    expect(f.rpc).toHaveBeenCalledWith("parent_save_schedule", { p_device_id: DEV, p_schedule_id: null, p_name: "Bedtime", p_type: "BEDTIME", p_days: [1], p_start_time: "21:00", p_end_time: "07:00", p_enabled: true });
  });
  it("needs a verified user", async () => {
    const f = fake({ user: null });
    expect(await svc.saveSchedule(f.deps, form())).toMatchObject({ ok: false, redirectTo: "/login" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("created clears the form, updated and unchanged keep the values", async () => {
    expect(await svc.saveSchedule(fake().deps, form())).toEqual({ ok: true, deviceId: DEV, outcome: "created", message: CREATED_MESSAGE, values: {} });
    const u = await svc.saveSchedule(fake(outcome("updated")).deps, form({ [FIELD.scheduleId]: SCH }));
    expect(u).toMatchObject({ ok: true, outcome: "updated" });
    expect(u.ok && u.values[FIELD.name]).toBe("Bedtime");
    expect(await svc.saveSchedule(fake(outcome("unchanged")).deps, form({ [FIELD.scheduleId]: SCH }))).toMatchObject({ ok: true, outcome: "unchanged", message: UNCHANGED_MESSAGE });
  });
  it("maps overlap, limit, inactive and not_found", async () => {
    expect(await svc.saveSchedule(fake(outcome("overlap")).deps, form())).toMatchObject({ ok: false, message: OVERLAP_MESSAGE });
    expect(await svc.saveSchedule(fake(outcome("limit_reached")).deps, form())).toMatchObject({ ok: false, message: LIMIT_MESSAGE });
    expect(await svc.saveSchedule(fake(outcome("inactive")).deps, form())).toMatchObject({ ok: false, message: INACTIVE_MESSAGE, readOnly: true });
    expect(await svc.saveSchedule(fake(outcome("not_found")).deps, form())).toMatchObject({ ok: false, notFound: true });
    expect(await svc.saveSchedule(fake(outcome("not_found")).deps, form({ [FIELD.scheduleId]: SCH }))).toMatchObject({ ok: false, message: SCHEDULE_GONE_MESSAGE });
  });
  it("maps errors by code and never logs values", async () => {
    expect(await svc.saveSchedule(fake({ rpc: { error: { code: "42501" } } }).deps, form())).toMatchObject({ redirectTo: "/login" });
    expect(await svc.saveSchedule(fake({ rpc: { error: { code: "22023" } } }).deps, form())).toMatchObject({ ok: false });
    expect(await svc.saveSchedule(fake({ rpc: { error: { code: "XX000" } } }).deps, form())).toMatchObject({ ok: false, message: "Something went wrong. Please try again." });
    expect(await svc.saveSchedule(fake(outcome("weird")).deps, form())).toMatchObject({ ok: false });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain("Bedtime");
    expect(logged).not.toContain(DEV);
  });
  it("rate-limits after 60 saves", async () => {
    const f = fake();
    for (let i = 0; i < 60; i++) expect((await svc.saveSchedule(f.deps, form())).ok).toBe(true);
    expect(await svc.saveSchedule(f.deps, form())).toMatchObject({ ok: false, message: expect.stringMatching(/Too many/) });
    expect(f.rpc).toHaveBeenCalledTimes(60);
  });
});

describe("deleteSchedule", () => {
  const del = (o: Record<string, unknown> = {}) => ({ [FIELD.deviceId]: DEV, [FIELD.scheduleId]: SCH, ...o });
  it("deletes through the RPC", async () => {
    const f = fake(outcome("deleted"));
    expect(await svc.deleteSchedule(f.deps, del())).toMatchObject({ ok: true, deviceId: DEV });
    expect(f.rpc).toHaveBeenCalledWith("parent_delete_schedule", { p_device_id: DEV, p_schedule_id: SCH });
  });
  it("validates first and maps outcomes", async () => {
    const f = fake();
    expect(await svc.deleteSchedule(f.deps, del({ [FIELD.deviceId]: "x" }))).toMatchObject({ ok: false, notFound: true });
    expect(await svc.deleteSchedule(f.deps, del({ [FIELD.scheduleId]: "x" }))).toMatchObject({ ok: false, message: SCHEDULE_GONE_MESSAGE });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(await svc.deleteSchedule(fake(outcome("not_found")).deps, del())).toMatchObject({ ok: false, message: SCHEDULE_GONE_MESSAGE });
    expect(await svc.deleteSchedule(fake(outcome("inactive")).deps, del())).toMatchObject({ ok: false, readOnly: true });
    expect(await svc.deleteSchedule(fake({ user: null }).deps, del())).toMatchObject({ redirectTo: "/login" });
  });
});

describe("setDeviceTimezone", () => {
  const tz = (v: string) => ({ [FIELD.deviceId]: DEV, [FIELD.timezone]: v });
  it("sends null for the phone's own zone and the name otherwise", async () => {
    const f = fake(outcome("updated"));
    await svc.setDeviceTimezone(f.deps, tz(""));
    await svc.setDeviceTimezone(f.deps, tz("Asia/Dhaka"));
    expect(f.rpc).toHaveBeenNthCalledWith(1, "parent_set_device_timezone", { p_device_id: DEV, p_timezone: null });
    expect(f.rpc).toHaveBeenNthCalledWith(2, "parent_set_device_timezone", { p_device_id: DEV, p_timezone: "Asia/Dhaka" });
  });
  it("maps 22023 to unknown zone and the outcomes", async () => {
    expect(await svc.setDeviceTimezone(fake({ rpc: { error: { code: "22023" } } }).deps, tz("Mars/Base"))).toMatchObject({ ok: false, message: TIMEZONE_UNKNOWN_MESSAGE });
    expect(await svc.setDeviceTimezone(fake(outcome("unchanged")).deps, tz("UTC"))).toMatchObject({ ok: true, outcome: "unchanged" });
    expect(await svc.setDeviceTimezone(fake(outcome("not_found")).deps, tz("UTC"))).toMatchObject({ ok: false, notFound: true });
    expect(await svc.setDeviceTimezone(fake(outcome("inactive")).deps, tz("UTC"))).toMatchObject({ ok: false, readOnly: true });
  });
  it("an abbreviation never reaches the RPC", async () => {
    const f = fake();
    expect(await svc.setDeviceTimezone(f.deps, tz("EST"))).toMatchObject({ ok: false });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
