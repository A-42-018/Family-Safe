// CORS: explicit origin allow-list (no wildcard). Device (Android) calls send no Origin header.
export const ALLOWED_HEADERS = "authorization, content-type, x-client-info, apikey, x-request-id";
export const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(req: Request, allowed: string[]): Record<string, string> {
  const origin = req.headers.get("origin");
  const base: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Max-Age": "600",
  };
  if (origin && allowed.includes(origin)) base["Access-Control-Allow-Origin"] = origin;
  return base;
}

/** Returns a Response for preflight, or null to continue handling. */
export function handlePreflight(req: Request, allowed: string[]): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req, allowed) });
}
