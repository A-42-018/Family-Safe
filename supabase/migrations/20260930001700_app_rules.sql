-- Phase 18a — app restrictions (SQL layer): validated parent write, versioned config, device read, BLOCKED_APP_ATTEMPT events.
-- Model: `app_rules` (Phase 3) keeps one row per (device, package). A row is only a *restriction* while
--   blocked = true            the app is not allowed; a stored daily_limit_minutes is kept for when it is unblocked and is
--                             ignored while blocked (blocked wins);
--   daily_limit_minutes 0..1440   minutes per local day (0 = no use that day).
-- A row with blocked = false and no limit has no effect: the parent RPC deletes it (no row = no rule) and the device read
-- never returns it. Rules are ONLY ever delivered to the device by pull (`device_get_config`), never through commands/FCM.
-- Versioning (same mechanism as Phase 17a): every real change of an effective rule moves `device_rules.app_rules_revision`
-- (AFTER triggers on app_rules, SECURITY DEFINER because the parent has no grant on the counter). The 17a BEFORE trigger sees
-- the new revision, bumps `config_version`, and the 17a AFTER trigger queues one SYNC_CONFIG command + a RULE_CHANGED audit
-- row (field name 'app_rules', never package names or values). So EVERY write path is versioned — the RPC below, direct
-- PostgREST writes under the parent's column grants, seed/service writes — and a no-op never bumps the version.
-- Guards that hold on every path (not only in the RPC): max 200 rules per device (BEFORE INSERT, serialised on the device
-- row), the child app itself cannot be restricted (CHECK).
-- Parent write path: `parent_set_app_rule` (SECURITY DEFINER, `authenticated`): ownership decided in SQL (foreign ≙ missing →
-- 'not_found'), strict validation (22023), the package must be in the reported inventory when a rule is created.
-- Device read path: `device_get_config` gains `o_app_rules` (service_role only, read-only).
-- Device event path: `device_record_app_attempts` (service_role only): BLOCKED_APP_ATTEMPT rows in `device_events`,
-- throttled per package, capped per day, only for packages that are blocked right now.
-- Enforcement honesty (Track A): the app can detect + inform, it cannot hard-block; hard block = Track B (docs/ANDROID_PERMISSIONS).

-- ---------------------------------------------------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.device_rules
  add column app_rules_revision int not null default 0 check (app_rules_revision >= 0);

alter table public.app_rules
  add constraint app_rules_not_self check (package_name <> 'app.familysafe.child');

-- ---------------------------------------------------------------------------------------------------------------------
-- 17a triggers: the payload now also contains the effective app rules, tracked through app_rules_revision.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_rules_bump_config_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.daily_screen_limit_minutes, new.daily_limit_overrides, new.bedtime_enabled,
      new.bedtime_start, new.bedtime_end, new.school_mode_enabled, new.app_rules_revision)
     is distinct from
     (old.daily_screen_limit_minutes, old.daily_limit_overrides, old.bedtime_enabled,
      old.bedtime_start, old.bedtime_end, old.school_mode_enabled, old.app_rules_revision)
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
      case when new.app_rules_revision         is distinct from old.app_rules_revision         then 'app_rules' end
    ], null);
    insert into public.audit_logs (parent_id, device_id, action, metadata)
    values (v_parent, new.device_id, 'RULE_CHANGED', jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return null;
end;
$$;
revoke all on function public.device_rules_config_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- app_rules triggers
-- ---------------------------------------------------------------------------------------------------------------------
-- Cap: at most 200 rules per device, on every insert path. The device row lock serialises concurrent inserts.
create or replace function public.app_rules_enforce_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.devices d where d.id = new.device_id for update;
  if (select count(*) from public.app_rules a where a.device_id = new.device_id) >= 200 then
    raise exception 'too many app rules' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.app_rules_enforce_cap() from public, anon, authenticated;

create trigger app_rules_cap
  before insert on public.app_rules
  for each row execute function public.app_rules_enforce_cap();

-- Revision bump: only a change of what the device would enforce counts (a rename or a no-effect row does not).
create or replace function public.app_rules_touch_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.device_rules
     set app_rules_revision = app_rules_revision + 1
   where device_id = coalesce(new.device_id, old.device_id); -- 0 rows while the device is being deleted: harmless
  return null;
end;
$$;
revoke all on function public.app_rules_touch_revision() from public, anon, authenticated;

create trigger app_rules_revision_insert
  after insert on public.app_rules
  for each row when (new.blocked or new.daily_limit_minutes is not null)
  execute function public.app_rules_touch_revision();

create trigger app_rules_revision_update
  after update on public.app_rules
  for each row when (old.blocked is distinct from new.blocked
                     or old.daily_limit_minutes is distinct from new.daily_limit_minutes)
  execute function public.app_rules_touch_revision();

create trigger app_rules_revision_delete
  after delete on public.app_rules
  for each row when (old.blocked or old.daily_limit_minutes is not null)
  execute function public.app_rules_touch_revision();

-- ---------------------------------------------------------------------------------------------------------------------
-- Parent write
-- ---------------------------------------------------------------------------------------------------------------------
--   'updated'     : rule created or changed (versioned, SYNC_CONFIG queued, RULE_CHANGED audited by the triggers)
--   'cleared'     : blocked = false and no limit asked for, and a rule existed -> it is deleted (versioned)
--   'unchanged'   : identical to what is stored (or "no rule" asked for and none exists) -> nothing written
--   'not_found'   : no such device, or it belongs to another family (never distinguishable)
--   'inactive'    : the caller's device exists but is not ENROLLED (revoked / pending) -> rules are read-only
--   'unknown_app' : a NEW rule for a package the device has not reported in its app inventory
-- Invalid input (package format, the child app itself, limit range, null flag) raises 22023; no session raises 42501;
-- more than 200 rules raises 22023 from the trigger.
create or replace function public.parent_set_app_rule(
  p_device_id           uuid,
  p_package_name        text,
  p_blocked             boolean,
  p_daily_limit_minutes int
)
returns table (o_outcome text, o_config_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_rule     public.app_rules%rowtype;
  v_has      boolean;
  v_label    text;
  v_outcome  text;
  v_version  int;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_package_name is null or char_length(p_package_name) > 255
     or p_package_name !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' then
    raise exception 'invalid package name' using errcode = '22023';
  end if;
  if p_package_name = 'app.familysafe.child' then
    raise exception 'the child app cannot be restricted' using errcode = '22023';
  end if;
  if p_blocked is null then
    raise exception 'blocked flag required' using errcode = '22023';
  end if;
  if p_daily_limit_minutes is not null and (p_daily_limit_minutes < 0 or p_daily_limit_minutes > 1440) then
    raise exception 'daily limit out of range' using errcode = '22023';
  end if;

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, 0;
    return;
  end if;

  -- Lock order: devices -> device_rules (via the triggers) -> app_rules rows; same as the other device functions.
  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  select * into v_rule from public.app_rules a
   where a.device_id = p_device_id and a.package_name = p_package_name for update;
  v_has := found;

  if not p_blocked and p_daily_limit_minutes is null then
    -- "No restriction": a stored row is removed, nothing is stored.
    if v_has then
      delete from public.app_rules where id = v_rule.id;
      v_outcome := 'cleared';
    else
      v_outcome := 'unchanged';
    end if;
  elsif v_has then
    if v_rule.blocked = p_blocked and v_rule.daily_limit_minutes is not distinct from p_daily_limit_minutes then
      v_outcome := 'unchanged';
    else
      update public.app_rules
         set blocked = p_blocked, daily_limit_minutes = p_daily_limit_minutes
       where id = v_rule.id;
      v_outcome := 'updated';
    end if;
  else
    select left(btrim(da.label), 200) into v_label from public.device_apps da
     where da.device_id = p_device_id and da.package_name = p_package_name;
    if v_label is null or v_label = '' then
      return query select 'unknown_app'::text, 0;
      return;
    end if;
    insert into public.app_rules (device_id, package_name, app_name, blocked, daily_limit_minutes)
    values (p_device_id, p_package_name, v_label, p_blocked, p_daily_limit_minutes);
    v_outcome := 'updated';
  end if;

  select r.config_version into v_version from public.device_rules r where r.device_id = p_device_id;
  return query select v_outcome, coalesce(v_version, 0);
end;
$$;
revoke all on function public.parent_set_app_rule(uuid, text, boolean, int) from public, anon;
grant execute on function public.parent_set_app_rule(uuid, text, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Device read: 17a function + the effective app rules (OUT columns change, so drop and recreate)
-- ---------------------------------------------------------------------------------------------------------------------
-- o_app_rules: jsonb array ordered by package name, at most 200 entries, only rows that restrict something:
--   [{"package_name": "...", "blocked": true|false, "daily_limit_minutes": 0..1440|null}, ...]
-- (app_name is deliberately not sent: the device knows its own labels.) Read-only.
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
  o_app_rules             jsonb
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
           ), '[]'::jsonb)
    from public.device_rules r
    join public.devices d on d.id = r.device_id
    where r.device_id = p_device_id and d.enrollment_status = 'ENROLLED';
  if not found then
    return query select 'inactive'::text, 0, null::int, '{}'::jsonb, false, null::text, null::text, false, '[]'::jsonb;
  end if;
end;
$$;
revoke all on function public.device_get_config(uuid) from public, anon, authenticated;
grant execute on function public.device_get_config(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Device events: BLOCKED_APP_ATTEMPT
-- ---------------------------------------------------------------------------------------------------------------------
-- p_events: array of 1..20 objects with EXACTLY {type, package_name, occurred_at}; type = 'BLOCKED_APP_ATTEMPT';
-- occurred_at = UTC "YYYY-MM-DDTHH:MM:SS[.f{1,9}]Z" within [now - 24 h, now + 5 min]. Any violation raises 22023 and nothing
-- is written (the Android side clamps/drops before sending).
-- An event is stored (device_events, metadata {package_name, occurred_at}) only when
--   * the package has a rule with blocked = true right now (a parent who unblocked meanwhile makes it 'ignored'),
--   * no BLOCKED_APP_ATTEMPT for that package lies within 300 s of its occurred_at (throttle; also dedupes retries),
--   * the device has fewer than 200 such events in the last 24 h (flood cap).
-- Outcomes: 'recorded' (counts say how many were stored / ignored — the Edge never tells the device) | 'inactive'
-- (unknown / not ENROLLED: nothing written). Never touches liveness columns, writes no audit row and no command.
create or replace function public.device_record_app_attempts(p_device_id uuid, p_events jsonb)
returns table (o_outcome text, o_recorded int, o_ignored int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  e          jsonb;
  v_pkg      text;
  v_at       timestamptz;
  v_recorded int := 0;
  v_ignored  int := 0;
  v_today    int;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 20 then
    raise exception 'events must be an array of 1 to 20 entries' using errcode = '22023';
  end if;

  -- Validate everything before touching any row.
  for e in select t.value from jsonb_array_elements(p_events) as t(value) loop
    if jsonb_typeof(e) <> 'object'
       or (select count(*) from jsonb_object_keys(e)) <> 3
       or not (e ? 'type' and e ? 'package_name' and e ? 'occurred_at')
       or jsonb_typeof(e -> 'type') <> 'string' or (e ->> 'type') <> 'BLOCKED_APP_ATTEMPT'
       or jsonb_typeof(e -> 'package_name') <> 'string'
       or jsonb_typeof(e -> 'occurred_at') <> 'string' then
      raise exception 'invalid event' using errcode = '22023';
    end if;
    v_pkg := e ->> 'package_name';
    if char_length(v_pkg) > 255 or v_pkg !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' then
      raise exception 'invalid package name' using errcode = '22023';
    end if;
    if (e ->> 'occurred_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' then
      raise exception 'invalid occurred_at' using errcode = '22023';
    end if;
    begin
      v_at := (e ->> 'occurred_at')::timestamptz;
    exception when others then
      raise exception 'invalid occurred_at' using errcode = '22023';
    end;
    if v_at < now() - interval '24 hours' or v_at > now() + interval '5 minutes' then
      raise exception 'occurred_at out of range' using errcode = '22023';
    end if;
  end loop;

  -- Lock order: devices first (same as the other device functions); the lock also serialises concurrent uploads, so the
  -- throttle below sees every earlier insert.
  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0, 0;
    return;
  end if;

  select count(*)::int into v_today from public.device_events ev
   where ev.device_id = p_device_id and ev.event_type = 'BLOCKED_APP_ATTEMPT'
     and ev.created_at > now() - interval '24 hours';

  for e in
    select t.value from jsonb_array_elements(p_events) as t(value)
     order by (t.value ->> 'occurred_at')::timestamptz, t.value ->> 'package_name'
  loop
    v_pkg := e ->> 'package_name';
    v_at  := (e ->> 'occurred_at')::timestamptz;

    if v_today >= 200
       or not exists (
         select 1 from public.app_rules r
          where r.device_id = p_device_id and r.package_name = v_pkg and r.blocked)
       or exists (
         select 1 from public.device_events ev
          where ev.device_id = p_device_id and ev.event_type = 'BLOCKED_APP_ATTEMPT'
            and ev.created_at > now() - interval '25 hours'
            and ev.metadata ->> 'package_name' = v_pkg
            and abs(extract(epoch from (v_at - (ev.metadata ->> 'occurred_at')::timestamptz))) < 300) then
      v_ignored := v_ignored + 1;
    else
      insert into public.device_events (device_id, event_type, metadata)
      values (p_device_id, 'BLOCKED_APP_ATTEMPT',
              jsonb_build_object(
                'package_name', v_pkg,
                'occurred_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      v_recorded := v_recorded + 1;
      v_today := v_today + 1;
    end if;
  end loop;

  return query select 'recorded'::text, v_recorded, v_ignored;
end;
$$;
revoke all on function public.device_record_app_attempts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.device_record_app_attempts(uuid, jsonb) to service_role;
