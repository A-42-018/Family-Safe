#!/usr/bin/env bash
# Builds the schema on a throwaway PostgreSQL DB (bootstrap -> migrations -> seed) and runs pgTAP.
# Usage: scripts/db/verify.sh   (needs psql, pg_prove, pgTAP; connects via PG* env vars)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${VERIFY_DB:-familysafe_verify}"
export PGOPTIONS='--client-min-messages=warning'
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "alter database ${DB} set search_path = public, extensions"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f scripts/db/bootstrap-plain-pg.sql
for f in supabase/migrations/*.sql; do echo "migrate $f"; psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/seed.sql
pg_prove -d "$DB" supabase/tests/database/*.test.sql
