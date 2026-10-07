import { describe, expect, it } from "vitest";
import {
  asAuditRow, auditQuery, auditSummary, AUDIT_PAGE_SIZE, describeAudit, humanizeAction, isCalendarDate, isFiltering, parseAuditFilters, toRpcArgs, type AuditRow,
} from "./audit";

const ID = "e0000000-0000-4000-8000-000000000001";
const DEV = "d0000000-0000-4000-8000-0000000000a1";
const raw = (over: Record<string, unknown> = {}) => ({
  o_id: ID, o_action: "LOGIN", o_device_id: null, o_device_name: null, o_metadata: {}, o_ip: null, o_created_at: "2026-10-01T09:00:00+00:00", ...over,
});
const row = (action: string, metadata: Record<string, unknown> = {}, over: Partial<AuditRow> = {}): AuditRow => ({
  id: ID, action, deviceId: null, deviceName: null, metadata, ip: null, at: "2026-10-01T09:00:00Z", ...over,
});

describe("asAuditRow", () => {
  it("maps a good RPC row", () => {
    expect(asAuditRow(raw({ o_device_id: DEV, o_device_name: "Phone", o_ip: "203.0.113.5", o_metadata: { method: "password" } }))).toEqual({
      id: ID, action: "LOGIN", deviceId: DEV, deviceName: "Phone", metadata: { method: "password" }, ip: "203.0.113.5", at: "2026-10-01T09:00:00+00:00",
    });
  });
  it("accepts an IPv6 address and drops odd ones", () => {
    expect(asAuditRow(raw({ o_ip: "2001:db8::1" }))?.ip).toBe("2001:db8::1");
    expect(asAuditRow(raw({ o_ip: "<script>" }))?.ip).toBeNull();
    expect(asAuditRow(raw({ o_ip: 5 }))?.ip).toBeNull();
  });
  it("keeps empty names and bad ids out and metadata an object", () => {
    expect(asAuditRow(raw({ o_device_name: "" }))?.deviceName).toBeNull();
    expect(asAuditRow(raw({ o_device_id: "nope" }))?.deviceId).toBeNull();
    expect(asAuditRow(raw({ o_metadata: [1] }))?.metadata).toEqual({});
    expect(asAuditRow(raw({ o_metadata: null }))?.metadata).toEqual({});
  });
  it("skips unusable rows", () => {
    for (const bad of [null, "x", {}, raw({ o_id: "nope" }), raw({ o_id: 1 }), raw({ o_action: "login" }), raw({ o_action: "A" }), raw({ o_created_at: "soon" }), raw({ o_created_at: null })]) {
      expect(asAuditRow(bad)).toBeNull();
    }
  });
});

describe("parseAuditFilters", () => {
  it("accepts good values", () => {
    const f = parseAuditFilters({ action: "RULE_CHANGED", device: DEV, from: "2026-09-01", to: "2026-09-30", before_at: "2026-10-01T09:00:00.000Z", before_id: ID });
    expect(f).toEqual({ action: "RULE_CHANGED", device: DEV, from: "2026-09-01", to: "2026-09-30", before: { at: "2026-10-01T09:00:00.000Z", id: ID } });
  });
  it("turns every bad value into no filter", () => {
    const f = parseAuditFilters({ action: "NOPE", device: "x", from: "2026-02-30", to: "yesterday", before_at: "2026-10-01T09:00:00Z", before_id: "not-a-uuid" });
    expect(f).toEqual({ action: null, device: null, from: null, to: null, before: null });
    expect(parseAuditFilters({})).toEqual({ action: null, device: null, from: null, to: null, before: null });
  });
  it("drops an empty range instead of failing and ignores a half cursor", () => {
    expect(parseAuditFilters({ from: "2026-09-30", to: "2026-09-01" })).toMatchObject({ from: "2026-09-30", to: null });
    expect(parseAuditFilters({ before_at: "2026-10-01T09:00:00Z" }).before).toBeNull();
    expect(parseAuditFilters({ before_id: ID }).before).toBeNull();
  });
  it("takes the first of repeated parameters and never throws on junk", () => {
    expect(parseAuditFilters({ action: ["LOGIN", "RULE_CHANGED"] }).action).toBe("LOGIN");
    expect(parseAuditFilters({ action: "", device: "", from: "" }).action).toBeNull();
  });
  it("isCalendarDate rejects impossible and ancient dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "2019-12-31", "", "2026-02-28T00:00"]) expect(isCalendarDate(bad)).toBe(false);
  });
  it("isFiltering ignores the cursor", () => {
    expect(isFiltering(parseAuditFilters({ before_at: "2026-10-01T09:00:00Z", before_id: ID }))).toBe(false);
    expect(isFiltering(parseAuditFilters({ action: "LOGIN" }))).toBe(true);
  });
});

describe("toRpcArgs / auditQuery", () => {
  it("asks for one extra row and turns days into a half-open UTC range", () => {
    const f = parseAuditFilters({ action: "LOGIN", from: "2026-09-01", to: "2026-09-30" });
    expect(toRpcArgs(f)).toEqual({
      p_action: "LOGIN", p_device_id: null, p_from: "2026-09-01T00:00:00.000Z", p_to: "2026-10-01T00:00:00.000Z",
      p_before_at: null, p_before_id: null, p_limit: AUDIT_PAGE_SIZE + 1,
    });
  });
  it("carries the cursor and handles the end of a year", () => {
    const f = parseAuditFilters({ to: "2026-12-31", before_at: "2026-10-01T09:00:00.000Z", before_id: ID });
    expect(toRpcArgs(f)).toMatchObject({ p_to: "2027-01-01T00:00:00.000Z", p_before_at: "2026-10-01T09:00:00.000Z", p_before_id: ID });
  });
  it("builds a link query that round-trips through the parser", () => {
    const f = parseAuditFilters({ action: "RULE_CHANGED", device: DEV, from: "2026-09-01" });
    const cursor = { at: "2026-10-01T09:00:00.000Z", id: ID };
    const query = auditQuery(f, cursor);
    const parsed = parseAuditFilters(Object.fromEntries(new URLSearchParams(query.slice(1))));
    expect(parsed).toEqual({ ...f, before: cursor });
    expect(auditQuery(parseAuditFilters({}), null)).toBe("");
  });
});

describe("describeAudit", () => {
  it("sign-ins show the method and the address; nothing else shows the address", () => {
    expect(describeAudit(row("LOGIN", { method: "mfa_totp" }, { ip: "203.0.113.5" }))).toMatchObject({ title: "Sign-in", detail: "with two-step verification", ip: "203.0.113.5" });
    expect(describeAudit(row("LOGIN", { method: "password" }))).toMatchObject({ detail: "with a password", ip: null });
    expect(describeAudit(row("LOGIN", { method: "<script>" })).detail).toBeNull();
    expect(describeAudit(row("DEVICE_REMOVED", {}, { ip: "203.0.113.5" })).ip).toBeNull();
  });
  it("rule changes list only known field names, once each", () => {
    expect(describeAudit(row("RULE_CHANGED", { fields: ["daily_screen_limit_minutes", "app_rules", "app_rules", "evil", 5] })).detail).toBe("Changed: daily limit, app rules");
    expect(describeAudit(row("RULE_CHANGED", { fields: ["evil"] })).detail).toBeNull();
    expect(describeAudit(row("RULE_CHANGED", {})).detail).toBeNull();
  });
  it("blocking and unblocking carry no detail and the device name", () => {
    expect(describeAudit(row("APP_BLOCKED", { fields: ["blocked"] }, { deviceName: "Phone" }))).toMatchObject({ title: "App blocked", detail: null, device: "Phone" });
    expect(describeAudit(row("APP_UNBLOCKED", { fields: ["blocked"] })).title).toBe("App unblocked");
  });
  it("device removal explains the reason from a fixed list", () => {
    expect(describeAudit(row("DEVICE_REMOVED", { reason: "revoked" })).detail).toBe("removed from the dashboard");
    expect(describeAudit(row("DEVICE_REMOVED", { reason: "credential_reuse" })).detail).toBe("removed after a security check");
    expect(describeAudit(row("DEVICE_REMOVED", { reason: "x" })).detail).toBeNull();
  });
  it("permission changes name the permissions only, never the states", () => {
    const d = describeAudit(row("PERMISSION_STATE_CHANGED", { changes: [{ permission: "camera", from: "GRANTED", to: "REVOKED" }, { permission: "camera" }, { permission: "nope" }, 3, null] }));
    expect(d.detail).toBe("Camera");
    expect(JSON.stringify(d)).not.toMatch(/GRANTED|REVOKED/);
  });
  it("unknown actions get a readable title and never print metadata", () => {
    const d = describeAudit(row("FUTURE_THING", { secret: "do-not-show" }));
    expect(d).toMatchObject({ title: "Future thing", detail: null });
    expect(JSON.stringify(d)).not.toContain("do-not-show");
    expect(humanizeAction("LOCATION_VIEWED")).toBe("Location viewed");
  });
});

describe("auditSummary", () => {
  it("says plainly what is shown", () => {
    expect(auditSummary(0, false, false)).toBe("Nothing has been recorded yet.");
    expect(auditSummary(0, true, false)).toBe("No entries match these filters.");
    expect(auditSummary(1, false, false)).toBe("Showing 1 entry.");
    expect(auditSummary(25, false, true)).toBe("Showing 25 entries, newest first.");
  });
});
