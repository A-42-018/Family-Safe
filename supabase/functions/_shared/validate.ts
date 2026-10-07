import { z, type ZodTypeAny } from "zod";
import { ApiError } from "./errors.ts";

export const MAX_BODY_BYTES = 64 * 1024;

function issues(err: z.ZodError) {
  // path + message only; never echo submitted values
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function parseWith<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ApiError("validation_error", "Invalid request", issues(r.error));
  return r.data;
}

/** Read + validate a JSON body with a hard size cap. */
export async function parseJsonBody<S extends ZodTypeAny>(req: Request, schema: S, maxBytes = MAX_BODY_BYTES): Promise<z.infer<S>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new ApiError("validation_error", "Content-Type must be application/json");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ApiError("validation_error", "Request body too large");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError("validation_error", "Request body too large");
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new ApiError("validation_error", "Malformed JSON"); }
  return parseWith(schema, json);
}

export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  return parseWith(schema, Object.fromEntries(new URL(req.url).searchParams));
}

export const uuidSchema = z.string().uuid();

/** Constant-time string comparison: no early exit on the first difference or on a length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
