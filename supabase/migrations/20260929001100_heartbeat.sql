-- Phase 12a — heartbeat: record coarse device status + online/offline transitions.
-- Both functions are SECURITY DEFINER and executable by service_role ONLY. The Edge Function authenticates the device
-- first (`requireActiveDevice`); the device id comes from the verified JWT, never from the request body.

-- 1) Record one heartbeat.
--    'recorded' : devices row updated (versions, battery, charging, network, last_seen_at = now(), device_status ONLINE).
--                 DEVICE_ONLINE is written only on a transition into ONLINE; BATTERY_LOW only when the device newly
--                 becomes "low" (level <= 15 and not charging). Event metadata is empty: no extra data is stored.
--    'inactive' : unknown device, or not ENROLLED (revoked/pending) -> nothing is written. The Edge Function answers
--                 with the same 401 as any other failed device authentication.
--    Row lock on the device serializes concurrent beats, so transitions are detected exactly once.
create or replace function public.device_heartbeat(
  p_device_id       uuid,
  p_app_version     text,
  p_android_version text,
  p_battery_level   int,
  p_is_charging     boolean,
  p_network_type    text
)
returns table (o_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_dev      text;
  v_old_bat  int;
  v_old_chg  boolean;
  v_was_low  boolean;
  v_is_low   boolean;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_app_version is null or char_length(btrim(p_app_version)) not between 1 and 32
     or p_android_version is null or char_length(btrim(p_android_version)) not between 1 and 32 then
    raise exception 'versions must be 1..32 characters' using errcode = '22023';
  end if;
  if p_battery_level is null or p_battery_level not between 0 and 100 then
    raise exception 'battery level out of range' using errcode = '22023';
  end if;
  if p_is_charging is null then
    raise exception 'charging flag required' using errcode = '22023';
  end if;
  if p_network_type is null or p_network_type not in ('WIFI','CELLULAR','ETHERNET','VPN','NONE','UNKNOWN') then
    raise exception 'unknown network type' using errcode = '22023';
  end if;

  select d.enrollment_status, d.device_status, d.battery_level, d.is_charging
    into v_status, v_dev, v_old_bat, v_old_chg
  from public.devices d
  where d.id = p_device_id
  for update;

  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text;
    return;
  end if;

  v_was_low := v_old_bat is not null and v_old_bat <= 15 and coalesce(v_old_chg, false) = false;
  v_is_low  := p_battery_level <= 15 and p_is_charging = false;

  update public.devices
     set app_version     = btrim(p_app_version),
         android_version = btrim(p_android_version),
         battery_level   = p_battery_level,
         is_charging     = p_is_charging,
         network_type    = p_network_type,
         last_seen_at    = now(),
         device_status   = 'ONLINE'
   where id = p_device_id;

  if v_dev <> 'ONLINE' then
    insert into public.device_events (device_id, event_type) values (p_device_id, 'DEVICE_ONLINE');
  end if;
  if v_is_low and not v_was_low then
    insert into public.device_events (device_id, event_type) values (p_device_id, 'BATTERY_LOW');
  end if;

  return query select 'recorded'::text;
end;
$$;

-- 2) Offline sweep: ENROLLED devices that are ONLINE but silent for longer than p_stale_seconds become OFFLINE with a
--    DEVICE_OFFLINE event. Returns how many devices changed. Not scheduled in this phase (Phase 31/34 decide how:
--    pg_cron or a scheduled Edge Function); the web UI also applies the same rule at read time (see docs/ARCHITECTURE §11).
create or replace function public.device_mark_stale_offline(p_stale_seconds int default 2700)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_stale_seconds is null or p_stale_seconds not between 300 and 86400 then
    raise exception 'stale threshold out of range' using errcode = '22023';
  end if;
  with stale as (
    update public.devices
       set device_status = 'OFFLINE'
     where enrollment_status = 'ENROLLED'
       and device_status = 'ONLINE'
       and last_seen_at < now() - make_interval(secs => p_stale_seconds)
    returning id
  ), ev as (
    insert into public.device_events (device_id, event_type)
    select id, 'DEVICE_OFFLINE' from stale
    returning 1
  )
  select count(*)::int into v_n from ev;
  return v_n;
end;
$$;

revoke all on function public.device_heartbeat(uuid, text, text, int, boolean, text) from public, anon, authenticated;
revoke all on function public.device_mark_stale_offline(int) from public, anon, authenticated;
grant execute on function public.device_heartbeat(uuid, text, text, int, boolean, text) to service_role;
grant execute on function public.device_mark_stale_offline(int) to service_role;
