-- Phase 3 / 1 — shared helpers
-- clock_timestamp() (not now()) so updated_at moves even inside one transaction.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ISO weekday set: 1 (Mon) .. 7 (Sun), non-empty, no duplicates.
create or replace function public.is_valid_day_set(days int[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select days is not null
     and cardinality(days) between 1 and 7
     and days <@ array[1,2,3,4,5,6,7]
     and cardinality(days) = (select count(distinct d) from unnest(days) as d);
$$;

revoke all on function public.set_updated_at()      from public, anon, authenticated;
revoke all on function public.is_valid_day_set(int[]) from public, anon, authenticated;
