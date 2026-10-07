-- 19d-1 — the legacy bedtime / school-mode columns of `device_rules` (Phase 3, shown read-only since 17a) are replaced by
-- real schedules (Phases 19a-19c): no parent write path, the web only displayed them, and the Android app stopped
-- reading them in 19c-2. Nothing is converted: no schedule was ever created from them.
--
-- Order matters: the trigger functions and `device_get_config` stop naming the columns first, then the columns go
-- (dropping them also drops the `device_rules_bedtime_chk` CHECK and their column-level UPDATE grant).

create or replace function public.device_rules_bump_config_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.daily_screen_limit_minutes, new.daily_limit_overrides, new.app_rules_revision,
      new.timezone, new.schedules_revision)
     is distinct from
     (old.daily_screen_limit_minutes, old.daily_limit_overrides, old.app_rules_revision,
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

-- OUT columns change, so drop and recreate (same body as 19a, minus the four legacy columns).
drop function public.device_get_config(uuid);

create function public.device_get_config(p_device_id uuid)
returns table (
  o_outcome               text,
  o_config_version        int,
  o_daily_limit_minutes   int,
  o_daily_limit_overrides jsonb,
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
    return query select 'inactive'::text, 0, null::int, '{}'::jsonb, '[]'::jsonb, null::text, '[]'::jsonb;
  end if;
end;
$$;
revoke all on function public.device_get_config(uuid) from public, anon, authenticated;
grant execute on function public.device_get_config(uuid) to service_role;

alter table public.device_rules
  drop column bedtime_enabled,
  drop column bedtime_start,
  drop column bedtime_end,
  drop column school_mode_enabled;
