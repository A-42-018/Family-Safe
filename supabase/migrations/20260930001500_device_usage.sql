-- Phase 16a — usage statistics (SQL layer): the enrolled app reports, per calendar day, how long the screen was on,
-- how often it was unlocked and how long each app was in the foreground.
-- Stored per day: device_usage_daily (total_screen_minutes, unlock_count) and app_usage_daily (package_name,
-- foreground_minutes, launch_count) — the two tables from migration 000400. NOT stored: timestamps of single
-- sessions, notification or content data, per-hour breakdowns. A parent reads (and may delete) history; only the
-- device writes.
-- Rules:
--   * one report = one day (p_day) for one device; the same day may be reported several times (cumulative values);
--   * idempotent merge: per column the stored value becomes GREATEST(stored, reported) and nothing is ever deleted,
--     so a retried or re-ordered older report can never lower today's numbers (usage of a day only grows);
--   * bounds (nothing is truncated, a violation raises 22023 and writes nothing):
--       day in [current_date - 14, current_date + 1]  (late uploads after being offline; +1 covers time zones),
--       total_screen_minutes 0..1440, unlock_count 0..10000,
--       at most 200 apps per report, each foreground_minutes 0..1440 and launch_count 0..10000,
--       no duplicate package names, sum of the apps' foreground minutes <= 1440 (one foreground app at a time);
--   * devices.usage_synced_at = "usage last reported" (server time);
--   * never touches device_status / last_seen_at (only the heartbeat is the liveness signal); no device event and no
--     audit row (a usage report is not a parent action and is not in the audit action list of prompt §39).
-- SECURITY DEFINER, service_role only; the device id comes from the verified JWT, never from the request body.
-- Retention: usage rows are kept 90 days by the Phase 32 cleanup job (idx on usage_date already exists).

alter table public.devices
  add column usage_synced_at timestamptz;

-- Merge one day of usage into the stored rows.
--   p_day   : calendar day the numbers belong to (the child's local day, decided by the app).
--   p_usage : JSON object, exactly
--             {"total_screen_minutes": int, "unlock_count": int,
--              "apps": [{"package_name": text, "foreground_minutes": int, "launch_count": int}, ...]}
--   'recorded' : the stored day now holds at least these values.
--   'inactive' : unknown device or not ENROLLED -> nothing is written (Edge answers the usual 401).
-- Invalid input raises 22023.
create or replace function public.device_upload_usage(
  p_device_id uuid,
  p_day       date,
  p_usage     jsonb
)
returns table (o_outcome text, o_apps int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_apps   constant int := 200;
  c_past_days  constant int := 14;
  c_minutes    constant int := 1440;
  c_count_max  constant int := 10000;
  v_el         jsonb;
  v_apps       jsonb;
  v_total      int;
  v_unlock     int;
  v_status     text;
  v_sum        int := 0;
  v_fg         int;
  v_launch     int;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_day is null or p_day < current_date - c_past_days or p_day > current_date + 1 then
    raise exception 'usage day out of range' using errcode = '22023';
  end if;
  if p_usage is null or jsonb_typeof(p_usage) <> 'object'
     or (select count(*) from jsonb_object_keys(p_usage)) <> 3
     or not (p_usage ? 'total_screen_minutes' and p_usage ? 'unlock_count' and p_usage ? 'apps') then
    raise exception 'usage must have exactly total_screen_minutes, unlock_count, apps' using errcode = '22023';
  end if;
  if jsonb_typeof(p_usage -> 'total_screen_minutes') <> 'number'
     or jsonb_typeof(p_usage -> 'unlock_count') <> 'number'
     or jsonb_typeof(p_usage -> 'apps') <> 'array'
     or (p_usage ->> 'total_screen_minutes') !~ '^[0-9]{1,7}$'
     or (p_usage ->> 'unlock_count') !~ '^[0-9]{1,7}$' then
    raise exception 'usage has a wrong field type' using errcode = '22023';
  end if;
  v_total  := (p_usage ->> 'total_screen_minutes')::int;
  v_unlock := (p_usage ->> 'unlock_count')::int;
  v_apps   := p_usage -> 'apps';
  if v_total > c_minutes or v_unlock > c_count_max then
    raise exception 'usage value out of range' using errcode = '22023';
  end if;
  if jsonb_array_length(v_apps) > c_max_apps then
    raise exception 'too many apps' using errcode = '22023';
  end if;

  for v_el in select e from jsonb_array_elements(v_apps) as t(e) loop
    if jsonb_typeof(v_el) <> 'object'
       or (select count(*) from jsonb_object_keys(v_el)) <> 3
       or not (v_el ? 'package_name' and v_el ? 'foreground_minutes' and v_el ? 'launch_count') then
      raise exception 'app entry must have exactly package_name, foreground_minutes, launch_count' using errcode = '22023';
    end if;
    if jsonb_typeof(v_el -> 'package_name') <> 'string'
       or jsonb_typeof(v_el -> 'foreground_minutes') <> 'number'
       or jsonb_typeof(v_el -> 'launch_count') <> 'number'
       or (v_el ->> 'foreground_minutes') !~ '^[0-9]{1,7}$'
       or (v_el ->> 'launch_count') !~ '^[0-9]{1,7}$' then
      raise exception 'app entry has a wrong field type' using errcode = '22023';
    end if;
    if char_length(v_el ->> 'package_name') > 255
       or (v_el ->> 'package_name') !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' then
      raise exception 'invalid package name' using errcode = '22023';
    end if;
    v_fg     := (v_el ->> 'foreground_minutes')::int;
    v_launch := (v_el ->> 'launch_count')::int;
    if v_fg > c_minutes or v_launch > c_count_max then
      raise exception 'app usage value out of range' using errcode = '22023';
    end if;
    v_sum := v_sum + v_fg;
  end loop;
  if v_sum > c_minutes then
    raise exception 'app minutes exceed one day' using errcode = '22023';
  end if;
  if (select count(distinct e ->> 'package_name') from jsonb_array_elements(v_apps) as t(e))
       <> jsonb_array_length(v_apps) then
    raise exception 'duplicate package name' using errcode = '22023';
  end if;

  -- Lock order: devices -> usage tables (same order as the other device functions).
  select d.enrollment_status into v_status
  from public.devices d
  where d.id = p_device_id
  for update of d;

  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  insert into public.device_usage_daily (device_id, usage_date, total_screen_minutes, unlock_count)
  values (p_device_id, p_day, v_total, v_unlock)
  on conflict (device_id, usage_date) do update
    set total_screen_minutes = greatest(public.device_usage_daily.total_screen_minutes, excluded.total_screen_minutes),
        unlock_count         = greatest(public.device_usage_daily.unlock_count, excluded.unlock_count);

  insert into public.app_usage_daily (device_id, package_name, usage_date, foreground_minutes, launch_count)
  select p_device_id, x.package_name, p_day, x.foreground_minutes, x.launch_count
  from jsonb_to_recordset(v_apps) as x(package_name text, foreground_minutes int, launch_count int)
  on conflict (device_id, package_name, usage_date) do update
    set foreground_minutes = greatest(public.app_usage_daily.foreground_minutes, excluded.foreground_minutes),
        launch_count       = greatest(public.app_usage_daily.launch_count, excluded.launch_count);

  update public.devices set usage_synced_at = now() where id = p_device_id;

  return query select 'recorded'::text, jsonb_array_length(v_apps);
end;
$$;

revoke all on function public.device_upload_usage(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.device_upload_usage(uuid, date, jsonb) to service_role;
