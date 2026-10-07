// Fails if server-only secret names appear anywhere under apps/web (source or env files), except *.example docs comments.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const FORBIDDEN = ["SUPABASE_SERVICE_ROLE_KEY", "DEVICE_JWT_SECRET", "FCM_SERVICE_ACCOUNT_JSON", "PAIRING_TOKEN_PEPPER"];
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git"]);
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const text = readFileSync(p, "utf8");
    for (const k of FORBIDDEN) if (text.includes(k)) hits.push(`${p}: ${k}`);
  }
}
if (existsSync("apps/web")) walk("apps/web");
if (hits.length) { console.error("Server secrets referenced in web app:\n" + hits.join("\n")); process.exit(1); }
console.log("Web secrets check OK");
