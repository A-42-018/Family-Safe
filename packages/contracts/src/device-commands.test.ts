import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMAND_ACK_STATUSES, COMMAND_PULL_MAX, COMMAND_SEND_PER_HOUR, COMMAND_TTL_HOURS, COMMAND_TYPES, commandAckRequestSchema, deviceCommandsResponseSchema,
  FCM_WAKEUP_TYPE, fcmTokenRequestSchema, fcmWakeupDataSchema, PUSH_TOKEN_MAX, PUSH_TOKEN_MIN, sendCommandInputSchema,
} from "./device-commands";

const ID = "e0000000-0000-4000-8000-000000000001";
const TOKEN = "fGh1:APA91bHx_-.abcdefghijklmnopqrstuvwxyz0123456789";

describe("fcmTokenRequestSchema", () => {
  it("accepts a realistic token and the length bounds", () => {
    expect(fcmTokenRequestSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(fcmTokenRequestSchema.safeParse({ token: "a".repeat(PUSH_TOKEN_MIN) }).success).toBe(true);
    expect(fcmTokenRequestSchema.safeParse({ token: "a".repeat(PUSH_TOKEN_MAX) }).success).toBe(true);
  });
  it.each([
    ["too short", { token: "a".repeat(PUSH_TOKEN_MIN - 1) }],
    ["too long", { token: "a".repeat(PUSH_TOKEN_MAX + 1) }],
    ["space", { token: `${TOKEN} x` }],
    ["control character", { token: `${TOKEN}\n` }],
    ["quote", { token: `${TOKEN}'` }],
    ["slash", { token: `${TOKEN}/x` }],
    ["missing", {}],
    ["extra key", { token: TOKEN, device_id: ID }],
    ["number", { token: 5 }],
  ])("rejects %s", (_n, body) => expect(fcmTokenRequestSchema.safeParse(body).success).toBe(false));
});

describe("commandAckRequestSchema", () => {
  it("accepts EXECUTED and FAILED only", () => {
    for (const status of COMMAND_ACK_STATUSES) expect(commandAckRequestSchema.safeParse({ command_id: ID, status }).success).toBe(true);
    for (const status of ["DELIVERED", "EXPIRED", "PENDING", "executed", ""]) expect(commandAckRequestSchema.safeParse({ command_id: ID, status }).success).toBe(false);
  });
  it("rejects a bad id, a missing key and extra keys", () => {
    for (const body of [{ command_id: "x", status: "EXECUTED" }, { status: "EXECUTED" }, { command_id: ID }, { command_id: ID, status: "EXECUTED", device_id: ID }]) {
      expect(commandAckRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("deviceCommandsResponseSchema / wake-up / parent input", () => {
  it("accepts a response with commands and none", () => {
    const base = { server_time: "2026-10-01T09:00:00.000Z" };
    expect(deviceCommandsResponseSchema.safeParse({ ...base, commands: [] }).success).toBe(true);
    expect(deviceCommandsResponseSchema.safeParse({ ...base, commands: [{ id: ID, type: "SYNC_CONFIG", expires_at: "2026-10-02T09:00:00+00:00" }] }).success).toBe(true);
  });
  it("rejects an unknown type, a payload and too many commands", () => {
    const base = { server_time: "2026-10-01T09:00:00.000Z" };
    expect(deviceCommandsResponseSchema.safeParse({ ...base, commands: [{ id: ID, type: "LOCK_DEVICE", expires_at: "2026-10-02T09:00:00Z" }] }).success).toBe(false);
    expect(deviceCommandsResponseSchema.safeParse({ ...base, commands: [{ id: ID, type: "SYNC_CONFIG", expires_at: "2026-10-02T09:00:00Z", payload: {} }] }).success).toBe(false);
    expect(deviceCommandsResponseSchema.safeParse({ ...base, commands: Array.from({ length: COMMAND_PULL_MAX + 1 }, () => ({ id: ID, type: "SYNC_CONFIG", expires_at: "2026-10-02T09:00:00Z" })) }).success).toBe(false);
  });
  it("the wake-up carries only the type and the command id", () => {
    expect(fcmWakeupDataSchema.safeParse({ type: FCM_WAKEUP_TYPE, cmd_id: ID }).success).toBe(true);
    for (const body of [{ type: "SYNC" }, { cmd_id: ID }, { type: "sync", cmd_id: ID }, { type: "SYNC", cmd_id: ID, rules: "x" }, { type: "SYNC", cmd_id: "x" }]) {
      expect(fcmWakeupDataSchema.safeParse(body).success).toBe(false);
    }
  });
  it("parent input needs a device id and a known type", () => {
    expect(sendCommandInputSchema.safeParse({ device_id: ID, type: "SYNC_CONFIG" }).success).toBe(true);
    for (const body of [{ device_id: ID, type: "LOCK_DEVICE" }, { device_id: "x", type: "SYNC_CONFIG" }, { type: "SYNC_CONFIG" }, { device_id: ID, type: "SYNC_CONFIG", payload: {} }]) {
      expect(sendCommandInputSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("SQL (migration 20261007000800_command_sync.sql) agrees with the contract", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261007000800_command_sync.sql", import.meta.url), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("the only command type, TTL, throttle and pull limits are the contract's", () => {
    expect([...COMMAND_TYPES]).toEqual(["SYNC_CONFIG"]);
    expect(code.match(/command_type in \('SYNC_CONFIG'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(code).toContain("p_type not in ('SYNC_CONFIG')");
    expect(code).toContain(`interval '${COMMAND_TTL_HOURS} hours'`);
    expect(code).toContain(`>= ${COMMAND_SEND_PER_HOUR} then`);
    expect(code).toContain(`v_limit > ${COMMAND_PULL_MAX}`);
  });
  it("the token rules are the contract's", () => {
    expect(code).toContain(`char_length(p_token) not between ${PUSH_TOKEN_MIN} and ${PUSH_TOKEN_MAX}`);
    expect(code).toContain("p_token !~ '^[A-Za-z0-9:_.-]+$'");
  });
  it("the ack statuses are the contract's", () => {
    expect(code).toContain(`p_status not in (${COMMAND_ACK_STATUSES.map((s) => `'${s}'`).join(", ")})`);
  });
  it("device functions are service_role only; the parent function is authenticated only; all SECURITY DEFINER with an empty search_path", () => {
    for (const f of [
      "device_register_push_token(uuid, text)", "device_commands_pull(uuid, int)", "device_command_ack(uuid, uuid, text)", "device_commands_expire()",
      "device_commands_to_push(int)", "device_command_mark_pushed(uuid)", "device_token_forget(uuid, text)",
    ]) {
      expect(code).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(code).toContain(`grant execute on function public.${f} to service_role;`);
    }
    expect(code).toContain("revoke all on function public.parent_send_command(uuid, text) from public, anon;");
    expect(code).toContain("grant execute on function public.parent_send_command(uuid, text) to authenticated;");
    expect(code.match(/security definer\s+set search_path = ''/g)?.length).toBe(9); // eight above + retention_run
  });
  it("nothing in the sender helpers selects anything but the token a push needs, and parents cannot reach the token table", () => {
    expect(code).not.toMatch(/grant [^;]*device_tokens[^;]*authenticated/i);
  });
});

describe("Edge mirror and functions agree with the contract and the SQL parameter names", () => {
  const read = (rel: string): string => readFileSync(new URL(`../../../supabase/${rel}`, import.meta.url), "utf8");
  const mirror = read("functions/_shared/device-commands.ts");
  const sql = read("migrations/20261007000800_command_sync.sql");
  it("the mirror has the same constants and strict schemas", () => {
    expect(mirror).toContain(`export const COMMAND_TYPES = [${COMMAND_TYPES.map((t) => `"${t}"`).join(", ")}] as const;`);
    expect(mirror).toContain(`export const COMMAND_ACK_STATUSES = [${COMMAND_ACK_STATUSES.map((t) => `"${t}"`).join(", ")}] as const;`);
    expect(mirror).toContain(`COMMAND_PULL_MAX = ${COMMAND_PULL_MAX};`);
    expect(mirror).toContain(`PUSH_TOKEN_MIN = ${PUSH_TOKEN_MIN};`);
    expect(mirror).toContain(`PUSH_TOKEN_MAX = ${PUSH_TOKEN_MAX};`);
    expect(mirror).toContain("PUSH_TOKEN_PATTERN = /^[A-Za-z0-9:_.-]+$/;");
    expect(mirror.match(/\.strict\(\)/g)).toHaveLength(2);
    for (const field of ["token: z.string()", "command_id: z.string().uuid()", "status: z.enum(COMMAND_ACK_STATUSES)"]) expect(mirror).toContain(field);
  });
  it("each Edge function calls its RPC with exactly the parameters the SQL declares", () => {
    const cases: [string, string, string[]][] = [
      ["device-fcm-token", "device_register_push_token", ["p_device_id", "p_token"]],
      ["device-commands", "device_commands_pull", ["p_device_id", "p_limit"]],
      ["device-commands", "device_command_ack", ["p_device_id", "p_command_id", "p_status"]],
    ];
    for (const [fn, rpc, params] of cases) {
      const index = read(`functions/${fn}/index.ts`);
      expect(index).toContain(`"${rpc}"`);
      const decl = sql.slice(sql.indexOf(`function public.${rpc}(`), sql.indexOf("returns", sql.indexOf(`function public.${rpc}(`)));
      for (const p of params) {
        expect(index).toContain(p);
        expect(decl).toContain(p);
      }
    }
  });
  it("the handlers answer with the server time only (pull adds the id/type/expiry list) and never name a device", () => {
    for (const fn of ["device-fcm-token", "device-commands"]) {
      const handler = read(`functions/${fn}/handler.ts`);
      expect(handler).toContain("requireActiveDevice");
      expect(handler).toContain("server_time: new Date(nowMs).toISOString()");
      expect(handler).not.toMatch(/device_id\s*:/);
    }
  });
});
