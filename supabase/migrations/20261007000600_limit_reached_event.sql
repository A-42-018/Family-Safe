-- 29d-1 — "today's screen-time limit was reached" reaches the parent (prompt §49) without sending any usage numbers.
-- The app reports ONE thing per local day: the day (`YYYY-MM-DD`) and when it happened. The database stores a
-- `LIMIT_REACHED` device event with exactly those two values; the 29a-2 trigger turns it into a notification.
-- No minutes, no package name, no label. Nothing is stored when the device has no limit configured (the answer is the same, so the device
-- learns nothing about the rules from it), and a second report for the same day is ignored.
-- Never changes `device_status`/`last_seen_at`, writes no audit row and queues no command.

create or replace function public.device_record_limit_reached(
  p_device_id   uuid,
  p_day         date,
  p_occurred_at timestamptz
)
returns table (o_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_today  date := (now() at time zone 'UTC')::date;
  v_day    text;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_day is null or p_day < v_today - 1 or p_day > v_today + 1 then
    raise exception 'day out of range' using errcode = '22023';
  end if;
  if p_occurred_at is null
     or p_occurred_at < now() - interval '24 hours'
     or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'time out of range' using errcode = '22023';
  end if;

  select d.enrollment_status into v_status
    from public.devices d
   where d.id = p_device_id
     for update;

  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text;
    return;
  end if;

  -- Nothing configured: nothing to be "reached". Same answer as a stored event.
  if not exists (
       select 1 from public.device_rules r
        where r.device_id = p_device_id
          and (r.daily_screen_limit_minutes is not null or r.daily_limit_overrides <> '{}'::jsonb)
     ) then
    return query select 'recorded'::text;
    return;
  end if;

  v_day := to_char(p_day, 'YYYY-MM-DD');
  if exists (
       select 1 from public.device_events e
        where e.device_id = p_device_id and e.event_type = 'LIMIT_REACHED' and e.metadata ->> 'day' = v_day
     ) then
    return query select 'recorded'::text;
    return;
  end if;

  insert into public.device_events (device_id, event_type, metadata)
  values (p_device_id, 'LIMIT_REACHED',
          jsonb_build_object('day', v_day,
                             'occurred_at', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

  return query select 'recorded'::text;
end;
$$;

revoke all on function public.device_record_limit_reached(uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function public.device_record_limit_reached(uuid, date, timestamptz) to service_role;
