// Per-request, nonce-based Content-Security-Policy (set in middleware.ts).
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  supabaseUrl?: string;
}

export function buildCsp({ nonce, isDev, supabaseUrl }: CspOptions): string {
  let connect = "'self'";
  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl);
      const ws = u.protocol === "https:" ? "wss:" : "ws:";
      connect += ` ${u.origin} ${ws}//${u.host}`;
    } catch { /* invalid URL is rejected by env validation elsewhere */ }
  }
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src": "'self' 'unsafe-inline'", // Tailwind/Next inline style attributes; scripts remain nonce-only
    "img-src": "'self' data: blob:", // data: needed for Supabase TOTP QR (SVG data URI)
    "font-src": "'self'",
    "connect-src": isDev ? `${connect} ws://localhost:*` : connect,
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v}`);
  // Skip when Supabase is plain-http (local stack run in production mode) so local smoke tests keep working.
  if (!isDev && (!supabaseUrl || supabaseUrl.startsWith("https:"))) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
