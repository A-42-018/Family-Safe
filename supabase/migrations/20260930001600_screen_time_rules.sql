-- Phase 17a — screen-time rules (SQL layer): validated parent write, versioned config, device pull, SYNC_CONFIG command.
-- Model: one `device_rules` row per device (created by the on_device_created trigger). The "config" the enrolled app
-- enforces is the payload-relevant subset of that row:
--   daily_screen_limit_minutes   NULL = no default daily limit, else 0..1440
--   daily_limit_overrides        jsonb object {"1".."7": 0..1440}; ISO weekday (1 = Mon). A present key replaces the default
--                                limit for that weekday (0 = no screen time that day); an absent key uses the default.
--   bedtime_enabled/start/end    (existing columns; the schedule engine itself is Phase 19)
--   school_mode_enabled          (existing column)
-- Location toggles are NOT part of this payload yet (Phase 21 extends `device_rules_config_changed`/`device_get_config`).
-- Versioning: `config_version` starts at 1 and rises by exactly 1 whenever a payload-relevant column really changes
-- (BEFORE UPDATE trigger, so EVERY write path — RPC, direct PostgREST column grants, seed — is versioned; the parent has no
-- grant on config_version or daily_limit_overrides). A no-op update never bumps it.
-- On a real change an AFTER UPDATE trigger (same transaction):
--   * queues ONE `SYNC_CONFIG` device command (payload {} — FCM/devices never receive rule values in a command, the device
--     pulls them through `device_get_config`) unless a PENDING one already exists (the device always pulls the latest);
--     only for ENROLLED devices, expires after 24 h;
--   * writes a `RULE_CHANGED` audit row (field NAMES only, never values) when the change was made by the owning parent
--     (auth.uid() owns the device); service-role/seed changes are not attributed to a parent and write no audit row.
-- Parent write path: `parent_set_screen_time_rules` (SECURITY DEFINER, `authenticated`): ownership decided in SQL
-- (foreign ≙ missing → 'not_found'), strict validation (22023), no-op detection, returns the new version.
-- Device read path: `device_get_config` (SECURITY DEFINER, service_role only); the device id comes from the verified JWT.
-- The per-day evaluation itself (which weekday is "today" on the child's device) is the Android side (17c); time-zone
-- storage per device/child is Phase 19.

-- Weekday -> minutes object. NULL-safe, never raises (used in a CHECK and in the RPC).
create or replace function public.is_valid_day_limits(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p) = 'object' then
             not exists (
               select 1
               from jsonb_each(p) as t(k, v)
               where t.k !~ '^[1-7]$'
                  or jsonb_typeof(t.v) <> 'number'
                  or t.v::text !~ '^[0-9]{1,4}$'
                  or (case when t.v::text ~ '^[0-9]{1,4}$' then t.v::text::int > 1440 else true end)
             )
           else false
         end;
$$;
revoke all on function public.is_valid_day_limits(jsonb) from public, anon;
grant execute on function public.is_valid_day_limits(jsonb) to authenticated, service_role; -- CHECK functions need EXECUTE for the writer

alter table public.device_rules
  add column daily_limit_overrides jsonb not null default '{}'::jsonb
    check (public.is_valid_day_limits(daily_limit_overrides)),
  add column config_version int not null default 1
    check (config_version >= 1);

-- Version bump (BEFORE so the new value is part of the same row write). config_version can never be set by a caller.
create or replace function public.device_rules_bump_config_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.daily_screen_limit_minutes, new.daily_limit_overrides, new.bedtime_enabled,
      new.bedtime_start, new.bedtime_end, new.school_mode_enabled)
     is distinct from
     (old.daily_screen_limit_minutes, old.daily_limit_overrides, old.bedtime_enabled,
      old.bedtime_start, old.bedtime_end, old.school_mode_enabled)
  then
    new.config_version := old.config_version + 1;
  else
    new.config_version := old.config_version;
  end if;
  return new;
end;
$$;
revoke all on function public.device_rules_bump_config_version() from public, anon, authenticated;

create trigger device_rules_config_version
  before update on public.device_rules
  for each row execute function public.device_rules_bump_config_version();

-- Queue SYNC_CONFIG + audit (AFTER, only when the version really moved).
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
      case when new.school_mode_enabled        is distinct from old.school_mode_enabled        then 'school_mode_enabled' end
    ], null);
    insert into public.audit_logs (parent_id, device_id, action, metadata)
    values (v_parent, new.device_id, 'RULE_CHANGED', jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return null;
end;
$$;
revoke all on function public.device_rules_config_changed() from public, anon, authenticated;

create trigger device_rules_config_changed
  after update on public.device_rules
  for each row
  when (old.config_version is distinct from new.config_version)
  execute function public.device_rules_config_changed();

-- Parent write: default daily limit + per-weekday overrides.
--   'updated'   : stored and versioned (SYNC_CONFIG queued, RULE_CHANGED audited by the trigger)
--   'unchanged' : identical to what is stored -> no write, no version bump, no command, no audit row
--   'not_found' : no such device, or it belongs to another family (never distinguishable)
--   'inactive'  : the caller's device exists but is not ENROLLED (revoked / pending) -> rules are read-only
-- Invalid input raises 22023; no session raises 42501.
create or replace function public.parent_set_screen_time_rules(
  p_device_id             uuid,
  p_daily_limit_minutes   int,
  p_daily_limit_overrides jsonb
)
returns table (o_outcome text, o_config_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_limit    int;
  v_over     jsonb;
  v_version  int;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_daily_limit_minutes is not null and (p_daily_limit_minutes < 0 or p_daily_limit_minutes > 1440) then
    raise exception 'daily limit out of range' using errcode = '22023';
  end if;
  if p_daily_limit_overrides is null or not public.is_valid_day_limits(p_daily_limit_overrides) then
    raise exception 'invalid daily limit overrides' using errcode = '22023';
  end if;

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, 0;
    return;
  end if;

  -- Lock order: devices -> device_rules (same as the other device functions).
  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  select r.daily_screen_limit_minutes, r.daily_limit_overrides, r.config_version
    into v_limit, v_over, v_version
  from public.device_rules r where r.device_id = p_device_id for update of r;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;

  if v_limit is not distinct from p_daily_limit_minutes and v_over = p_daily_limit_overrides then
    return query select 'unchanged'::text, v_version;
    return;
  end if;

  update public.device_rules
     set daily_screen_limit_minutes = p_daily_limit_minutes,
         daily_limit_overrides      = p_daily_limit_overrides
   where device_id = p_device_id
  returning config_version into v_version;

  return query select 'updated'::text, v_version;
end;
$$;
revoke all on function public.parent_set_screen_time_rules(uuid, int, jsonb) from public, anon;
grant execute on function public.parent_set_screen_time_rules(uuid, int, jsonb) to authenticated;

-- Device read: the current enforceable config of an ENROLLED device.
--   'ok'       : row carries the config; bedtime times are NULL unless bedtime is enabled ("HH24:MI")
--   'inactive' : unknown / not ENROLLED -> all-default row, Edge answers the usual 401
-- Read-only: never writes (so it cannot bump updated_at or the version), never touches liveness columns.
create or replace function public.device_get_config(p_device_id uuid)
returns table (
  o_outcome              text,
  o_config_version       int,
  o_daily_limit_minutes  int,
  o_daily_limit_overrides jsonb,
  o_bedtime_enabled      boolean,
  o_bedtime_start        text,
  o_bedtime_end          text,
  o_school_mode_enabled  boolean
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
           r.school_mode_enabled
    from public.device_rules r
    join public.devices d on d.id = r.device_id
    where r.device_id = p_device_id and d.enrollment_status = 'ENROLLED';
  if not found then
    return query select 'inactive'::text, 0, null::int, '{}'::jsonb, false, null::text, null::text, false;
  end if;
end;
$$;
revoke all on function public.device_get_config(uuid) from public, anon, authenticated;
grant execute on function public.device_get_config(uuid) to service_role;
