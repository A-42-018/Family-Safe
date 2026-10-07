-- Phase 19a-1 — schedules (SQL layer): validated parent write, per-device time zone, versioned config, device read.
-- Model: `schedules` (Phase 3) keeps one row per window. A window has
--   type        BEDTIME | SCHOOL | CUSTOM        (school mode = SCHOOL windows; there is no separate flag)
--   days        ISO weekdays 1 (Mon) .. 7 (Sun), non-empty, no duplicates
--   start_time / end_time   whole minutes ("HH:MM"); end < start = OVERNIGHT: the window belongs to the day it STARTS on
--                           (Mon 22:00 -> 06:00 covers Monday night into Tuesday morning); start = end is invalid
--   enabled     disabled windows are stored but never delivered to the device
-- Rules that hold on EVERY write path (RPC, direct PostgREST grants, service role):
--   * at most 20 schedules per device (BEFORE INSERT, serialised on the device row),
--   * two ENABLED windows of the same type on one device must not overlap on the weekly timeline (windows are half-open,
--     so 08:00-15:00 and 15:00-18:00 do not overlap; overnight windows wrap Sunday -> Monday); different types may overlap,
--   * times have minute resolution (CHECK).
-- Time zone: `device_rules.timezone` (IANA name, e.g. 'Europe/Berlin') or NULL = "use the device's own time zone" (what
-- the Phase 17c limits already do). The parent sets it through `parent_set_device_timezone`; the name is checked against
-- pg_timezone_names and a format that Java's ZoneId also understands (Region/City or UTC; no abbreviations, no posix/right).
-- Versioning (same mechanism as 17a/18a): every real change of what the device would enforce moves
-- `device_rules.schedules_revision` (AFTER triggers on schedules; SECURITY DEFINER because the parent has no grant on the
-- counter); `timezone` is part of the 17a version tuple. The 17a BEFORE trigger bumps `config_version`, the 17a AFTER trigger
-- queues one SYNC_CONFIG and writes a RULE_CHANGED audit row (field names 'schedules' / 'timezone', never names or times).
-- Rules reach the device ONLY by pull (`device_get_config`), never through commands/FCM.
-- Legacy: `device_rules.bedtime_*` / `school_mode_enabled` (17a) stay in the payload and in the version tuple so the shipped
-- 17c/18c Android build keeps working. Schedules are the successor; Phase 19c ignores the legacy fields and a later cleanup
-- migration drops them. Nothing here reads them.
-- Parent write path: `parent_save_schedule`, `parent_delete_schedule`, `parent_set_device_timezone` (SECURITY DEFINER,
-- `authenticated`): ownership decided in SQL (foreign ≙ missing → 'not_found'), strict validation (22023).
-- Device read path: `device_get_config` gains `o_timezone` and `o_schedules` (service_role only, read-only).

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------------
-- Format of an IANA name we accept (immutable: used in a CHECK). 'UTC' or Region/City[/Sub]; no abbreviations (EST),
-- no 'posix/', 'right/' or 'SystemV/' trees (Java cannot resolve them).
create or replace function public.is_timezone_name_format(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and char_length(p) between 1 and 64
     and p ~ '^[A-Z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'
     and (p = 'UTC' or position('/' in p) > 0)
     and p !~ '^(SystemV|posix|right)/';
$$;
revoke all on function public.is_timezone_name_format(text) from public, anon;
grant execute on function public.is_timezone_name_format(text) to authenticated, service_role; -- CHECK functions need EXECUTE for the writer

-- Format + known to this PostgreSQL's tz database. NULL-safe, never raises.
create or replace function public.is_valid_iana_timezone(p text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_timezone_name_format(p)
     and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p);
$$;
revoke all on function public.is_valid_iana_timezone(text) from public, anon, authenticated;
grant execute on function public.is_valid_iana_timezone(text) to service_role;

-- The weekly-timeline footprint of one window, as half-open minute ranges within [0, 10080) (Monday 00:00 = 0).
-- An overnight window that runs past Sunday midnight is split in two ranges. Assumes valid input (callers check first).
create or replace function public.schedule_week_ranges(p_days int[], p_start time, p_end time)
returns setof int4range
language sql
immutable
set search_path = ''
as $$
  with m as (
    select (extract(hour from p_start) * 60 + extract(minute from p_start))::int as sm,
           (extract(hour from p_end)   * 60 + extract(minute from p_end))::int   as em
  ),
  b as (
    select (d - 1) * 1440 + m.sm as lo,
           (d - 1) * 1440 + m.sm + case when m.em > m.sm then m.em - m.sm else 1440 - m.sm + m.em end as hi
    from unnest(p_days) as d, m
  )
  select int4range(lo, least(hi, 10080), '[)') from b
  union all
  select int4range(0, hi - 10080, '[)') from b where hi > 10080;
$$;
revoke all on function public.schedule_week_ranges(int[], time, time) from public, anon, authenticated;
grant execute on function public.schedule_week_ranges(int[], time, time) to service_role;

-- Does a would-be ENABLED window collide with a stored ENABLED window of the same type on that device?
create or replace function public.schedule_conflicts(
  p_device_id uuid, p_type text, p_days int[], p_start time, p_end time, p_except uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.schedules s
    cross join lateral public.schedule_week_ranges(s.days, s.start_time, s.end_time) as a(r)
    cross join lateral public.schedule_week_ranges(p_days, p_start, p_end) as b(r)
    where s.device_id = p_device_id
      and s.type = p_type
      and s.enabled
      and (p_except is null or s.id <> p_except)
      and a.r && b.r
  );
$$;
revoke all on function public.schedule_conflicts(uuid, text, int[], time, time, uuid) from public, anon, authenticated;
grant execute on function public.schedule_conflicts(uuid, text, int[], time, time, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.device_rules
  add column timezone text check (timezone is null or public.is_timezone_name_format(timezone)),
  add column schedules_revision int not null default 0 check (schedules_revision >= 0);

alter table public.schedules
  add constraint schedules_minute_resolution
  check (extract(second from start_time) = 0 and extract(second from end_time) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 17a/18a triggers: the payload now also contains the time zone and the effective schedules.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_rules_bump_config_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.daily_screen_limit_minutes, new.daily_limit_overrides, new.bedtime_enabled,
      new.bedtime_start, new.bedtime_end, new.school_mode_enabled, new.app_rules_revision,
      new.timezone, new.schedules_revision)
     is distinct from
     (old.daily_screen_limit_minutes, old.daily_limit_overrides, old.bedtime_enabled,
      old.bedtime_start, old.bedtime_end, old.school_mode_enabled, old.app_rules_revision,
      old.timezone, old.schedules_revision)
  then
    new.config_version := old.config_version + 1;
  else
    new.config_version := old.config_version;
  end if;
  return new;
end;
$$;
revoke all on function public.device_rules_bump_config_version() from public, anon, authenticated;

create or replace function public.device_rules_config_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_parent uuid := (select auth.uid());
  v_fields text[];
begin
  select d.enrollment_status into v_status from public.devices d where d.id = new.device_id;

  -- Only PENDING dedupes: a DELIVERED command may have been handled before this change, so a new one is needed.
  if v_status = 'ENROLLED'
     and not exists (
       select 1 from public.device_commands c
       where c.device_id = new.device_id and c.command_type = 'SYNC_CONFIG'
         and c.status = 'PENDING' and c.expires_at > now()
     ) then
    insert into public.device_commands (device_id, command_type, payload, expires_at)
    values (new.device_id, 'SYNC_CONFIG', '{}'::jsonb, now() + interval '24 hours');
  end if;

  if v_parent is not null and public.owns_device(new.device_id) then
    v_fields := array_remove(array[
      case when new.daily_screen_limit_minutes is distinct from old.daily_screen_limit_minutes then 'daily_screen_limit_minutes' end,
      case when new.daily_limit_overrides      is distinct from old.daily_limit_overrides      then 'daily_limit_overrides' end,
      case when new.bedtime_enabled            is distinct from old.bedtime_enabled            then 'bedtime_enabled' end,
      case when new.bedtime_start              is distinct from old.bedtime_start              then 'bedtime_start' end,
      case when new.bedtime_end                is distinct from old.bedtime_end                then 'bedtime_end' end,
      case when new.school_mode_enabled        is distinct from old.school_mode_enabled        then 'school_mode_enabled' end,
      case when new.app_rules_revision         is distinct from old.app_rules_revision         then 'app_rules' end,
      case when new.timezone                   is distinct from old.timezone                   then 'timezone' end,
      case when new.schedules_revision         is distinct from old.schedules_revision         then 'schedules' end
    ], null);
    insert into public.audit_logs (parent_id, device_id, action, metadata)
    values (v_parent, new.device_id, 'RULE_CHANGED', jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return null;
end;
$$;
revoke all on function public.device_rules_config_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- schedules triggers
-- ---------------------------------------------------------------------------------------------------------------------
-- Cap + overlap on every write path. Runs BEFORE the CHECK constraints, so a row that is invalid for another reason is
-- left alone here and rejected by its CHECK (23514). Direct writes by a parent are only inspected when the parent owns
-- the device: for a foreign device the RLS policy answers (42501) and nothing about that device is revealed through the
-- error code. The device row lock serialises concurrent writers (lock order: devices -> schedules -> device_rules).
create or replace function public.schedules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.owns_device(new.device_id) then
    return new;
  end if;

  perform 1 from public.devices d where d.id = new.device_id for update;

  if tg_op = 'INSERT'
     and (select count(*) from public.schedules s where s.device_id = new.device_id) >= 20 then
    raise exception 'too many schedules' using errcode = '22023';
  end if;

  if new.enabled
     and new.type in ('BEDTIME', 'SCHOOL', 'CUSTOM')
     and public.is_valid_day_set(new.days)
     and new.start_time <> new.end_time
     and public.schedule_conflicts(new.device_id, new.type, new.days, new.start_time, new.end_time,
                                   case when tg_op = 'UPDATE' then new.id end)
  then
    raise exception 'schedule overlaps another enabled schedule of the same type' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.schedules_guard() from public, anon, authenticated;

create trigger schedules_guard
  before insert or update on public.schedules
  for each row execute function public.schedules_guard();

-- Revision bump: only a change of what the device would enforce counts (a disabled window is invisible to the device).
create or replace function public.schedules_touch_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.device_rules
     set schedules_revision = schedules_revision + 1
   where device_id = coalesce(new.device_id, old.device_id); -- 0 rows while the device is being deleted: harmless
  return null;
end;
$$;
revoke all on function public.schedules_touch_revision() from public, anon, authenticated;

create trigger schedules_revision_insert
  after insert on public.schedules
  for each row when (new.enabled)
  execute function public.schedules_touch_revision();

create trigger schedules_revision_update
  after update on public.schedules
  for each row when (
    (old.enabled or new.enabled)
    and (old.name, old.type, old.start_time, old.end_time, old.days, old.enabled)
        is distinct from
        (new.name, new.type, new.start_time, new.end_time, new.days, new.enabled))
  execute function public.schedules_touch_revision();

create trigger schedules_revision_delete
  after delete on public.schedules
  for each row when (old.enabled)
  execute function public.schedules_touch_revision();

-- ---------------------------------------------------------------------------------------------------------------------
-- Parent write: time zone
-- ---------------------------------------------------------------------------------------------------------------------
--   'updated'   : stored and versioned (p_timezone NULL = follow the device's own time zone)
--   'unchanged' : identical to what is stored -> nothing written
--   'not_found' : no such device, or it belongs to another family (never distinguishable)
--   'inactive'  : the caller's device exists but is not ENROLLED -> read-only
-- An unknown / malformed name raises 22023; no session raises 42501.
create or replace function public.parent_set_device_timezone(p_device_id uuid, p_timezone text)
returns table (o_outcome text, o_config_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_current text;
  v_version int;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_timezone is not null and not public.is_valid_iana_timezone(p_timezone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, 0;
    return;
  end if;

  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  select r.timezone, r.config_version into v_current, v_version
  from public.device_rules r where r.device_id = p_device_id for update of r;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  if v_current is not distinct from p_timezone then
    return query select 'unchanged'::text, v_version;
    return;
  end if;

  update public.device_rules set timezone = p_timezone
   where device_id = p_device_id
  returning config_version into v_version;

  return query select 'updated'::text, v_version;
end;
$$;
revoke all on function public.parent_set_device_timezone(uuid, text) from public, anon;
grant execute on function public.parent_set_device_timezone(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Parent write: create / update one schedule
-- ---------------------------------------------------------------------------------------------------------------------
-- p_schedule_id NULL = create, else update that schedule of that device. Times are 'HH:MM' text (24 h, minute resolution).
--   'created' | 'updated'  : stored and versioned (a disabled window is stored but the version only moves if the device
--                            would see a difference)
--   'unchanged'            : identical to what is stored -> nothing written
--   'overlap'              : an ENABLED window of the same type already covers part of this one -> nothing written
--   'limit_reached'        : the device already has 20 schedules (create only)
--   'not_found'            : no such device / schedule, or another family's (never distinguishable)
--   'inactive'             : the caller's device exists but is not ENROLLED -> read-only
-- Invalid input raises 22023; no session raises 42501.
create or replace function public.parent_save_schedule(
  p_device_id   uuid,
  p_schedule_id uuid,
  p_name        text,
  p_type        text,
  p_days        int[],
  p_start_time  text,
  p_end_time    text,
  p_enabled     boolean
)
returns table (o_outcome text, o_schedule_id uuid, o_config_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text;
  v_days    int[];
  v_start   time;
  v_end     time;
  v_status  text;
  v_id      uuid;
  v_version int;
  v_row     public.schedules%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_name is null or p_name ~ '[[:cntrl:]]' then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  v_name := btrim(p_name);
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('BEDTIME', 'SCHOOL', 'CUSTOM') then
    raise exception 'invalid type' using errcode = '22023';
  end if;
  if not public.is_valid_day_set(p_days) then
    raise exception 'invalid days' using errcode = '22023';
  end if;
  if p_start_time is null or p_start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_end_time is null or p_end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid time' using errcode = '22023';
  end if;
  v_start := p_start_time::time;
  v_end   := p_end_time::time;
  if v_start = v_end then
    raise exception 'start and end must differ' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'enabled required' using errcode = '22023';
  end if;
  v_days := array(select d from unnest(p_days) as d order by d); -- stored sorted, so equality below is stable

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, null::uuid, 0;
    return;
  end if;

  -- Lock order: devices -> schedules -> device_rules (the revision trigger).
  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found then
    return query select 'not_found'::text, null::uuid, 0;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, null::uuid, 0;
    return;
  end if;

  if p_schedule_id is null then
    if (select count(*) from public.schedules s where s.device_id = p_device_id) >= 20 then
      return query select 'limit_reached'::text, null::uuid, (select r.config_version from public.device_rules r where r.device_id = p_device_id);
      return;
    end if;
    if p_enabled and public.schedule_conflicts(p_device_id, p_type, v_days, v_start, v_end, null) then
      return query select 'overlap'::text, null::uuid, (select r.config_version from public.device_rules r where r.device_id = p_device_id);
      return;
    end if;
    insert into public.schedules (device_id, name, type, start_time, end_time, days, enabled)
    values (p_device_id, v_name, p_type, v_start, v_end, v_days, p_enabled)
    returning id into v_id;
    select r.config_version into v_version from public.device_rules r where r.device_id = p_device_id;
    return query select 'created'::text, v_id, v_version;
    return;
  end if;

  select * into v_row from public.schedules s
   where s.id = p_schedule_id and s.device_id = p_device_id for update of s;
  if not found then
    return query select 'not_found'::text, null::uuid, 0;
    return;
  end if;

  if v_row.name = v_name and v_row.type = p_type and v_row.days = v_days
     and v_row.start_time = v_start and v_row.end_time = v_end and v_row.enabled = p_enabled then
    select r.config_version into v_version from public.device_rules r where r.device_id = p_device_id;
    return query select 'unchanged'::text, v_row.id, v_version;
    return;
  end if;

  if p_enabled and public.schedule_conflicts(p_device_id, p_type, v_days, v_start, v_end, v_row.id) then
    return query select 'overlap'::text, v_row.id, (select r.config_version from public.device_rules r where r.device_id = p_device_id);
    return;
  end if;

  update public.schedules
     set name = v_name, type = p_type, days = v_days, start_time = v_start, end_time = v_end, enabled = p_enabled
   where id = v_row.id;
  select r.config_version into v_version from public.device_rules r where r.device_id = p_device_id;
  return query select 'updated'::text, v_row.id, v_version;
end;
$$;
revoke all on function public.parent_save_schedule(uuid, uuid, text, text, int[], text, text, boolean) from public, anon;
grant execute on function public.parent_save_schedule(uuid, uuid, text, text, int[], text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Parent write: delete one schedule
-- ---------------------------------------------------------------------------------------------------------------------
--   'deleted' | 'not_found' (no such device / schedule, or another family's) | 'inactive' (device not ENROLLED)
create or replace function public.parent_delete_schedule(p_device_id uuid, p_schedule_id uuid)
returns table (o_outcome text, o_config_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_version int;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null or p_schedule_id is null then
    raise exception 'ids required' using errcode = '22023';
  end if;

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, 0;
    return;
  end if;

  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  delete from public.schedules s where s.id = p_schedule_id and s.device_id = p_device_id;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  select r.config_version into v_version from public.device_rules r where r.device_id = p_device_id;
  return query select 'deleted'::text, v_version;
end;
$$;
revoke all on function public.parent_delete_schedule(uuid, uuid) from public, anon;
grant execute on function public.parent_delete_schedule(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Device read: 18a function + time zone + effective schedules (OUT columns change, so drop and recreate)
-- ---------------------------------------------------------------------------------------------------------------------
-- o_timezone : IANA name or NULL (= the device's own zone).
-- o_schedules: jsonb array of ENABLED windows only, ordered by type, start, id, at most 20:
--   [{"id": uuid, "name": text, "type": "BEDTIME|SCHOOL|CUSTOM", "days": [1..7 ascending],
--     "start_time": "HH:MM", "end_time": "HH:MM"}, ...]     (end_time < start_time = overnight, see header)
-- Read-only. The legacy bedtime/school columns are still returned unchanged (see header).
drop function public.device_get_config(uuid);

create function public.device_get_config(p_device_id uuid)
returns table (
  o_outcome               text,
  o_config_version        int,
  o_daily_limit_minutes   int,
  o_daily_limit_overrides jsonb,
  o_bedtime_enabled       boolean,
  o_bedtime_start         text,
  o_bedtime_end           text,
  o_school_mode_enabled   boolean,
  o_app_rules             jsonb,
  o_timezone              text,
  o_schedules             jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  return query
    select 'ok'::text,
           r.config_version,
           r.daily_screen_limit_minutes,
           r.daily_limit_overrides,
           r.bedtime_enabled,
           case when r.bedtime_enabled then left(r.bedtime_start::text, 5) end,
           case when r.bedtime_enabled then left(r.bedtime_end::text, 5) end,
           r.school_mode_enabled,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'package_name', x.package_name,
                        'blocked', x.blocked,
                        'daily_limit_minutes', x.daily_limit_minutes)
                      order by x.package_name)
             from (
               select a.package_name, a.blocked, a.daily_limit_minutes
               from public.app_rules a
               where a.device_id = r.device_id
                 and (a.blocked or a.daily_limit_minutes is not null)
               order by a.package_name
               limit 200
             ) x
           ), '[]'::jsonb),
           r.timezone,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'id', y.id,
                        'name', y.name,
                        'type', y.type,
                        'days', to_jsonb(array(select dd from unnest(y.days) as dd order by dd)),
                        'start_time', left(y.start_time::text, 5),
                        'end_time', left(y.end_time::text, 5))
                      order by y.type, y.start_time, y.id)
             from (
               select s.id, s.name, s.type, s.days, s.start_time, s.end_time
               from public.schedules s
               where s.device_id = r.device_id and s.enabled
               order by s.type, s.start_time, s.id
               limit 20
             ) y
           ), '[]'::jsonb)
    from public.device_rules r
    join public.devices d on d.id = r.device_id
    where r.device_id = p_device_id and d.enrollment_status = 'ENROLLED';
  if not found then
    return query select 'inactive'::text, 0, null::int, '{}'::jsonb, false, null::text, null::text, false, '[]'::jsonb,
                         null::text, '[]'::jsonb;
  end if;
end;
$$;
revoke all on function public.device_get_config(uuid) from public, anon, authenticated;
grant execute on function public.device_get_config(uuid) to service_role;
