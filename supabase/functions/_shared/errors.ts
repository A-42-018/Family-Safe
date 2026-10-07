// Error envelope: { data } | { error: { code, message, details? } } — see docs/API.md
export type ErrorCode =
  | "validation_error" | "unauthorized" | "forbidden" | "not_found"
  | "rate_limited" | "conflict" | "server_error";

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400, unauthorized: 401, forbidden: 403, not_found: 404,
  conflict: 409, rate_limited: 429, server_error: 500,
};

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown, public headers?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
  }
  get status(): number { return STATUS[this.code]; }
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function ok<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify({ data }), {
    status: init.status ?? 200,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

export function fail(err: ApiError, headers: Record<string, string> = {}): Response {
  const body: { error: { code: ErrorCode; message: string; details?: unknown } } = {
    error: { code: err.code, message: err.message },
  };
  if (err.details !== undefined) body.error.details = err.details;
  return new Response(JSON.stringify(body), { status: err.status, headers: { ...JSON_HEADERS, ...err.headers, ...headers } });
}

/** Convert any thrown value to a safe response. Internal errors never leak messages or stack traces. */
export function toErrorResponse(e: unknown, headers: Record<string, string> = {}): Response {
  if (e instanceof ApiError) return fail(e, headers);
  console.error("unhandled_error", e instanceof Error ? e.name : "unknown"); // name only: no message/PII
  return fail(new ApiError("server_error", "Internal server error"), headers);
}
