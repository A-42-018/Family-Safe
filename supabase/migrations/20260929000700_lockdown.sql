-- Phase 3 / 7 — deny-by-default lockdown. Phase 4 adds explicit RLS policies + minimal grants.
-- service_role (Edge Functions) keeps full access (bypasses RLS).

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Pure validation helper used inside CHECK constraints: Postgres checks EXECUTE for the
-- inserting role at runtime, so authenticated (Phase 4 writes) must be able to call it.
grant execute on function public.is_valid_day_set(int[]) to authenticated;

-- Guard: fail the migration if any public table lacks RLS.
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'RLS not enabled on: %', v_missing;
  end if;
end $$;
