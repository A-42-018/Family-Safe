// Runs the whole database layer (bootstrap -> every migration -> seed -> every pgTAP file) on an in-process PostgreSQL
// (PGlite, WebAssembly), so it works without Docker, psql or the pgTAP extension. pgTAP itself is replaced by the small
// compatible shim `tap-shim.sql` (same assertion names, same TAP output). CI still runs the real pgTAP (`verify.sh`);
// this is the fast local check and shows the exact failing assertion.
//
//   npm i --no-save @electric-sql/pglite     (once; not a project dependency)
//   npm run test:db:local                    (all files)        npm run test:db:local -- 21 22   (only files starting 21, 22)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let PGlite, pgcrypto;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
  ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
} catch {
  console.error("Missing optional tool. Run once:  npm i --no-save @electric-sql/pglite");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const only = process.argv.slice(2); // optional test-file prefixes, e.g. 21 22
const db = new PGlite({ extensions: { pgcrypto } });

async function run(sql, label) {
  try { return await db.exec(sql); }
  catch (e) { console.log(`ERROR in ${label}: ${e.message}`); throw e; }
}

let boot = fs.readFileSync(path.join(root, "scripts/db/bootstrap-plain-pg.sql"), "utf8").replace(/create extension if not exists pgtap[^;]*;/i, "");
await run(boot, "bootstrap");
await run(fs.readFileSync(path.join(root, "scripts/db/tap-shim.sql"), "utf8"), "shim");
const mig = path.join(root, "supabase/migrations");
for (const f of fs.readdirSync(mig).sort()) await run(fs.readFileSync(path.join(mig, f), "utf8"), `migration ${f}`);
await run(fs.readFileSync(path.join(root, "supabase/seed.sql"), "utf8"), "seed");
await db.exec("set search_path = public, extensions");

const dir = path.join(root, "supabase/tests/database");
let failedFiles = 0, totalOk = 0, totalFail = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".test.sql")).sort()) {
  if (only.length && !only.some((p) => f.startsWith(p))) continue;
  let lines = [];
  try {
    const results = await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const r of results) for (const row of r.rows ?? []) { const v = Object.values(row)[0]; if (typeof v === "string" && /^(ok|not ok|# finish|1\.\.)/.test(v)) lines.push(v); }
  } catch (e) {
    lines.push(`not ok - ABORTED: ${e.message}`);
    try { await db.exec("rollback"); } catch {}
  }
  await db.exec("reset role").catch(() => {});
  const bad = lines.filter((l) => l.startsWith("not ok"));
  const oks = lines.filter((l) => l.startsWith("ok ")).length;
  totalOk += oks; totalFail += bad.length;
  console.log(`${bad.length ? "FAIL" : "ok  "} ${f}  (${oks} ok, ${bad.length} not ok)`);
  if (bad.length) { failedFiles++; for (const b of bad) console.log("    " + b.split("\n").join("\n    ")); }
  const fin = lines.find((l) => l.startsWith("# finish")); if (fin && bad.length === 0) {}
}
console.log(`\n${failedFiles} failing file(s); ${totalOk} ok, ${totalFail} not ok`);
process.exit(failedFiles ? 1 : 0);
