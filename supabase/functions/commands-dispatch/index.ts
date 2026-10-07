import { getEnv } from "../_shared/env.ts";
import { toErrorResponse } from "../_shared/errors.ts";
import { createFcmSender, parseServiceAccount } from "../_shared/fcm.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { type Deps, handler } from "./handler.ts";

let deps: Deps | null = null;

function build(): Deps {
  const env = getEnv();
  if (!env.CRON_SECRET) throw new Error("config"); // no secret, no endpoint
  const service = createServiceClient(env);
  const send = createFcmSender(parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON));
  return {
    allowedOrigins: env.ALLOWED_ORIGINS,
    cronSecret: env.CRON_SECRET,
    async listDue(limit) {
      const { data, error } = await service.rpc("device_commands_to_push", { p_limit: limit });
      if (error) throw new Error("rpc_failed"); // never echo DB details
      return (Array.isArray(data) ? data : []).flatMap((r: Record<string, unknown>) =>
        typeof r.o_command_id === "string" && typeof r.o_device_id === "string" && typeof r.o_fcm_token === "string"
          ? [{ commandId: r.o_command_id, deviceId: r.o_device_id, token: r.o_fcm_token }]
          : []
      );
    },
    send,
    async markPushed(commandId) {
      const { error } = await service.rpc("device_command_mark_pushed", { p_command_id: commandId });
      if (error) throw new Error("rpc_failed");
    },
    async forgetToken(deviceId, token) {
      const { error } = await service.rpc("device_token_forget", { p_device_id: deviceId, p_token: token });
      if (error) throw new Error("rpc_failed");
    },
  };
}

Deno.serve((req) => {
  try {
    deps ??= build();
  } catch {
    return toErrorResponse(new Error("config"));
  }
  return handler(req, deps);
});
