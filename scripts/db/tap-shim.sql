-- Minimal pgTAP-compatible shim for PGlite (no pgTAP extension there). Counters live in transaction-local GUCs so they
-- survive `set local role`. Every assertion returns one TAP line; failures carry a "# ..." diagnostic.
create schema if not exists extensions;
create or replace function extensions.plan(n int) returns text language plpgsql as $$
begin
  perform set_config('tap.plan', n::text, true); perform set_config('tap.n', '0', true); perform set_config('tap.failed', '0', true);
  return '1..' || n;
end $$;
create or replace function extensions._res(p_ok boolean, p_desc text, p_diag text default '') returns text language plpgsql as $$
declare n int := coalesce(nullif(current_setting('tap.n', true), ''), '0')::int + 1;
begin
  perform set_config('tap.n', n::text, true);
  if not coalesce(p_ok, false) then
    perform set_config('tap.failed', (coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int + 1)::text, true);
  end if;
  return case when coalesce(p_ok, false) then 'ok ' else 'not ok ' end || n || ' - ' || coalesce(p_desc, '')
    || case when coalesce(p_ok, false) or coalesce(p_diag, '') = '' then '' else E'\n#   ' || replace(p_diag, E'\n', E'\n#   ') end;
end $$;
create or replace function extensions.finish() returns setof text language plpgsql as $$
declare pl int := coalesce(nullif(current_setting('tap.plan', true), ''), '0')::int; n int := coalesce(nullif(current_setting('tap.n', true), ''), '0')::int; f int := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int;
begin
  if n <> pl then return next 'not ok - PLAN MISMATCH: planned ' || pl || ' but ran ' || n; end if;
  return next '# finish: planned ' || pl || ', ran ' || n || ', failed ' || f;
end $$;
create or replace function extensions.ok(p_ok boolean, p_desc text default null) returns text language sql as $$ select extensions._res($1, $2, 'condition was ' || coalesce($1::text, 'NULL')) $$;
create or replace function extensions.is(a anyelement, b anyelement, p_desc text default null) returns text language sql as $$
  select extensions._res($1 is not distinct from $2, $3, 'have: ' || coalesce($1::text, 'NULL') || E'\nwant: ' || coalesce($2::text, 'NULL')) $$;
create or replace function extensions.isnt(a anyelement, b anyelement, p_desc text default null) returns text language sql as $$
  select extensions._res($1 is distinct from $2, $3, 'both were: ' || coalesce($1::text, 'NULL')) $$;
create or replace function extensions.cmp_ok(a anyelement, op text, b anyelement, p_desc text default null) returns text language plpgsql as $$
declare r boolean;
begin
  execute format('select $1 %s $2', op) into r using a, b;
  return extensions._res(r, p_desc, 'have: ' || coalesce(a::text, 'NULL') || E'\n' || op || E'\nwant: ' || coalesce(b::text, 'NULL'));
end $$;
create or replace function extensions.lives_ok(p_sql text, p_desc text default null) returns text language plpgsql as $$
begin
  execute p_sql;
  return extensions._res(true, p_desc);
exception when others then
  return extensions._res(false, p_desc, 'threw ' || sqlstate || ': ' || sqlerrm);
end $$;
create or replace function extensions.throws_ok(p_sql text, p_code text default null, p_msg text default null, p_desc text default null) returns text language plpgsql as $$
declare st text; msg text;
begin
  execute p_sql;
  return extensions._res(false, p_desc, 'no exception thrown; wanted ' || coalesce(p_code, 'any'));
exception when others then
  get stacked diagnostics msg = message_text; st := sqlstate;
  return extensions._res((p_code is null or st = p_code) and (p_msg is null or msg = p_msg), p_desc, 'caught ' || st || ': ' || msg || E'\nwanted ' || coalesce(p_code, 'any'));
end $$;
create or replace function extensions.results_eq(sql1 text, sql2 text, p_desc text default null) returns text language plpgsql as $$
declare r1 jsonb; r2 jsonb;
begin
  execute 'select coalesce(jsonb_agg(q::text), ''[]''::jsonb) from (' || sql1 || ') q' into r1;
  execute 'select coalesce(jsonb_agg(q::text), ''[]''::jsonb) from (' || sql2 || ') q' into r2;
  return extensions._res(r1 = r2, p_desc, 'have: ' || r1::text || E'\nwant: ' || r2::text);
exception when others then
  return extensions._res(false, p_desc, 'threw ' || sqlstate || ': ' || sqlerrm);
end $$;
create or replace function extensions.has_table(s name, t name, p_desc text default null) returns text language sql as $$
  select extensions._res(exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and c.relkind in ('r','p')), coalesce($3, 'table ' || $2), 'missing table') $$;
create or replace function extensions.has_column(s name, t name, c name, p_desc text default null) returns text language sql as $$
  select extensions._res(exists (select 1 from pg_attribute a join pg_class k on k.oid = a.attrelid join pg_namespace n on n.oid = k.relnamespace where n.nspname = $1 and k.relname = $2 and a.attname = $3 and a.attnum > 0 and not a.attisdropped), coalesce($4, 'column ' || $3), 'missing column') $$;
create or replace function extensions.col_is_null(s name, t name, c name, p_desc text default null) returns text language sql as $$
  select extensions._res(exists (select 1 from pg_attribute a join pg_class k on k.oid = a.attrelid join pg_namespace n on n.oid = k.relnamespace where n.nspname = $1 and k.relname = $2 and a.attname = $3 and not a.attnotnull), coalesce($4, 'column ' || $3 || ' allows NULL'), 'column is NOT NULL') $$;
create or replace function extensions.col_is_unique(s name, t name, c name[], p_desc text default null) returns text language sql as $$
  select extensions._res(exists (
    select 1 from pg_index i join pg_class k on k.oid = i.indrelid join pg_namespace n on n.oid = k.relnamespace
     where n.nspname = $1 and k.relname = $2 and i.indisunique and i.indpred is null and i.indnatts = cardinality($3)
       and (select array_agg(a.attname::text order by a.attname::text) from unnest(i.indkey) as u(attnum) join pg_attribute a on a.attrelid = k.oid and a.attnum = u.attnum) = (select array_agg(x::text order by x::text) from unnest($3) x)
  ), coalesce($4, 'unique ' || $2), 'no matching unique index') $$;
create or replace function extensions.fk_ok(fs name, ft name, fc name[], ps name, pt name, pc name[], p_desc text default null) returns text language sql as $$
  select extensions._res(exists (
    select 1 from pg_constraint c join pg_class k on k.oid = c.conrelid join pg_namespace n on n.oid = k.relnamespace join pg_class pk on pk.oid = c.confrelid join pg_namespace pn on pn.oid = pk.relnamespace
     where c.contype = 'f' and n.nspname = $1 and k.relname = $2 and pn.nspname = $4 and pk.relname = $5
       and (select array_agg(a.attname::text order by u.ord) from unnest(c.conkey) with ordinality as u(attnum, ord) join pg_attribute a on a.attrelid = k.oid and a.attnum = u.attnum) = $3::text[]
       and (select array_agg(a.attname::text order by u.ord) from unnest(c.confkey) with ordinality as u(attnum, ord) join pg_attribute a on a.attrelid = pk.oid and a.attnum = u.attnum) = $6::text[]
  ), coalesce($7, 'fk ' || $2), 'no matching foreign key') $$;
create or replace function extensions.fk_ok(fs name, ft name, fc name, ps name, pt name, pc name, p_desc text default null) returns text language sql as $$
  select extensions.fk_ok($1, $2, array[$3], $4, $5, array[$6], $7) $$;
create or replace function extensions.tables_are(s name, expected name[], p_desc text default null) returns text language sql as $$
  select extensions._res(
    (select coalesce(array_agg(c.relname::text order by c.relname::text), '{}') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r','p'))
      = (select coalesce(array_agg(x::text order by x::text), '{}') from unnest($2) x),
    $3,
    'have: ' || (select coalesce(string_agg(c.relname::text, ',' order by c.relname::text), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r','p')) || E'\nwant: ' || (select string_agg(x::text, ',' order by x::text) from unnest($2) x)) $$;
grant usage on schema extensions to public;
