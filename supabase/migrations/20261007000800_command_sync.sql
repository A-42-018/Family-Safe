-- 20a-1 — command sync (prompt §16, §41): the SQL half of "the parent asks, the device pulls".
-- FCM is only a wake-up (20a-3 sends `{type:"SYNC", cmd_id}` and nothing else); a command is never trusted from the push —
-- the device pulls its commands from the backend (`device_commands_pull`), validates the type, acts and acknowledges.
-- Replay protection and expiry are database rules: the state machine of `enforce_command_transition` (a command executes
-- at most once and never after `expires_at`), idempotent acknowledgements, and an expiry sweep inside `retention_run`.
--
-- Only `SYNC_CONFIG` ("pull your rules now") is an allowed command type for now.

alter table public.device_commands add column pushed_at timestamptz;   -- set once the wake-up was handed to FCM

-- ---------------------------------------------------------------------------------------------------------------------
-- Device: register the FCM token (one per device; a token that moves to another device is taken over).
--   'registered' | 'unchanged' | 'inactive' (unknown or not ENROLLED: nothing stored)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_register_push_token(p_device_id uuid, p_token text)
returns table (o_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_old    text;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 4096 or p_token !~ '^[A-Za-z0-9:_.-]+$' then
    raise exception 'invalid push token' using errcode = '22023';
  end if;

  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update;
  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text;
    return;
  end if;

  select t.fcm_token into v_old from public.device_tokens t where t.device_id = p_device_id;
  if v_old is not distinct from p_token then
    return query select 'unchanged'::text;
    return;
  end if;

  delete from public.device_tokens t where t.fcm_token = p_token and t.device_id <> p_device_id;
  insert into public.device_tokens (device_id, fcm_token) values (p_device_id, p_token)
  on conflict (device_id) do update set fcm_token = excluded.fcm_token, updated_at = now();
  return query select 'registered'::text;
end;
$$;
revoke all on function public.device_register_push_token(uuid, text) from public, anon, authenticated;
grant execute on function public.device_register_push_token(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Device: pull my commands. Returns unexpired PENDING/DELIVERED commands of a known type, oldest first (a command that
-- was delivered but never acknowledged is returned again; the device dedupes by id), and marks PENDING ones DELIVERED.
-- A device that is not ENROLLED gets one row with o_outcome = 'inactive'; otherwise rows have o_outcome = 'ok'.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_commands_pull(p_device_id uuid, p_limit int default 10)
returns table (o_outcome text, o_id uuid, o_command_type text, o_payload jsonb, o_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_limit  int := coalesce(p_limit, 10);
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'limit out of range' using errcode = '22023';
  end if;

  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update;
  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text, null::uuid, null::text, null::jsonb, null::timestamptz;
    return;
  end if;

  return query
    with due as (
      select c.id
        from public.device_commands c
       where c.device_id = p_device_id
         and c.status in ('PENDING', 'DELIVERED')
         and c.expires_at > now()
         and c.command_type in ('SYNC_CONFIG')
       order by c.created_at, c.id
       limit v_limit
         for update
    ), marked as (
      update public.device_commands c set status = 'DELIVERED'
        from due where c.id = due.id and c.status = 'PENDING'
      returning c.id
    )
    select 'ok'::text, c.id, c.command_type, c.payload, c.expires_at
      from public.device_commands c
      join due on due.id = c.id
     order by c.created_at, c.id;
end;
$$;
revoke all on function public.device_commands_pull(uuid, int) from public, anon, authenticated;
grant execute on function public.device_commands_pull(uuid, int) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Device: acknowledge a command. p_status is EXECUTED or FAILED.
--   'acked'      first acknowledgement
--   'unchanged'  already EXECUTED/FAILED (a replay changes nothing)
--   'expired'    past expires_at (marked EXPIRED, never executed late)
--   'not_found'  not this device's command (a foreign id looks exactly like a missing one)
--   'inactive'   unknown or not ENROLLED
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_command_ack(p_device_id uuid, p_command_id uuid, p_status text)
returns table (o_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_cmd    public.device_commands%rowtype;
begin
  if p_device_id is null or p_command_id is null then
    raise exception 'ids required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('EXECUTED', 'FAILED') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update;
  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text;
    return;
  end if;

  select * into v_cmd from public.device_commands c where c.id = p_command_id and c.device_id = p_device_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  if v_cmd.status in ('EXECUTED', 'FAILED') then
    return query select 'unchanged'::text;
    return;
  end if;
  if v_cmd.status = 'EXPIRED' or v_cmd.expires_at <= clock_timestamp() then
    if v_cmd.status <> 'EXPIRED' then
      update public.device_commands set status = 'EXPIRED' where id = v_cmd.id;
    end if;
    return query select 'expired'::text;
    return;
  end if;

  if v_cmd.status = 'PENDING' then
    update public.device_commands set status = 'DELIVERED' where id = v_cmd.id;
  end if;
  update public.device_commands
     set status = p_status,
         executed_at = case when p_status = 'EXECUTED' then now() else null end
   where id = v_cmd.id;
  return query select 'acked'::text;
end;
$$;
revoke all on function public.device_command_ack(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.device_command_ack(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Expiry sweep: PENDING/DELIVERED commands past expires_at become EXPIRED. Part of `retention_run`; returns the count.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_commands_expire()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with gone as (
    update public.device_commands set status = 'EXPIRED'
     where status in ('PENDING', 'DELIVERED') and expires_at <= now()
    returning 1
  )
  select count(*)::int into v_n from gone;
  return v_n;
end;
$$;
revoke all on function public.device_commands_expire() from public, anon, authenticated;
grant execute on function public.device_commands_expire() to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Parent: "refresh the device now". SYNC_CONFIG only. Outcomes:
--   'sent' (o_command_id = the new command) | 'already_pending' (o_command_id = the open one) | 'throttled' (6 per
--   hour per device) | 'not_found' (foreign ≙ missing) | 'inactive' (not ENROLLED). Audited as DEVICE_COMMAND_SENT with
--   the command name only. The wake-up push is a separate step (20a-3); the device also pulls on its own schedule.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.parent_send_command(p_device_id uuid, p_type text)
returns table (o_outcome text, o_command_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (select auth.uid());
  v_status text;
  v_open   uuid;
  v_id     uuid;
begin
  if v_parent is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_type is null or p_type not in ('SYNC_CONFIG') then
    raise exception 'unknown command type' using errcode = '22023';
  end if;

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, null::uuid;
    return;
  end if;

  select c.id into v_open
    from public.device_commands c
   where c.device_id = p_device_id and c.command_type = p_type and c.status = 'PENDING' and c.expires_at > now()
   order by c.created_at desc limit 1;
  if v_open is not null then
    return query select 'already_pending'::text, v_open;
    return;
  end if;

  if (select count(*) from public.audit_logs a
       where a.device_id = p_device_id and a.action = 'DEVICE_COMMAND_SENT' and a.created_at > now() - interval '1 hour') >= 6 then
    return query select 'throttled'::text, null::uuid;
    return;
  end if;

  insert into public.device_commands (device_id, command_type, payload, expires_at)
  values (p_device_id, p_type, '{}'::jsonb, now() + interval '24 hours')
  returning id into v_id;
  insert into public.audit_logs (parent_id, device_id, action, metadata)
  values (v_parent, p_device_id, 'DEVICE_COMMAND_SENT', jsonb_build_object('command', p_type));
  return query select 'sent'::text, v_id;
end;
$$;
revoke all on function public.parent_send_command(uuid, text) from public, anon;
grant execute on function public.parent_send_command(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Push sender helpers (20a-3), service_role only. The token is never selectable by parents (no policy, no grant).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_commands_to_push(p_limit int default 50)
returns table (o_command_id uuid, o_device_id uuid, o_fcm_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := coalesce(p_limit, 50);
begin
  if v_limit < 1 or v_limit > 200 then
    raise exception 'limit out of range' using errcode = '22023';
  end if;
  return query
    select c.id, c.device_id, t.fcm_token
      from public.device_commands c
      join public.devices d on d.id = c.device_id and d.enrollment_status = 'ENROLLED'
      join public.device_tokens t on t.device_id = c.device_id
     where c.status = 'PENDING' and c.pushed_at is null and c.expires_at > now()
       and c.command_type in ('SYNC_CONFIG')
     order by c.created_at, c.id
     limit v_limit;
end;
$$;
revoke all on function public.device_commands_to_push(int) from public, anon, authenticated;
grant execute on function public.device_commands_to_push(int) to service_role;

create or replace function public.device_command_mark_pushed(p_command_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_command_id is null then
    raise exception 'command id required' using errcode = '22023';
  end if;
  with m as (
    update public.device_commands set pushed_at = now() where id = p_command_id and pushed_at is null returning 1
  )
  select count(*)::int into v_n from m;
  return v_n = 1;
end;
$$;
revoke all on function public.device_command_mark_pushed(uuid) from public, anon, authenticated;
grant execute on function public.device_command_mark_pushed(uuid) to service_role;

-- FCM said the token is no longer valid: forget exactly that token for that device.
create or replace function public.device_token_forget(p_device_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_device_id is null or p_token is null then
    raise exception 'device id and token required' using errcode = '22023';
  end if;
  with d as (
    delete from public.device_tokens where device_id = p_device_id and fcm_token = p_token returning 1
  )
  select count(*)::int into v_n from d;
  return v_n = 1;
end;
$$;
revoke all on function public.device_token_forget(uuid, text) from public, anon, authenticated;
grant execute on function public.device_token_forget(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- retention_run (32a) again, now also expiring commands right after the offline sweep.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.retention_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out   jsonb := '{}'::jsonb;
  v_n     int;
  v_today date  := (now() at time zone 'UTC')::date;
begin
  v_out := v_out || jsonb_build_object('devices_marked_offline', public.device_mark_stale_offline());
  v_out := v_out || jsonb_build_object('device_commands_expired', public.device_commands_expire());
  v_out := v_out || jsonb_build_object('audit_logs', public.audit_purge_expired());
  v_out := v_out || jsonb_build_object('notifications', public.notifications_purge_expired());

  with gone as (delete from public.device_events where created_at < now() - interval '90 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_events', v_n);

  with gone as (delete from public.app_usage_daily where usage_date < v_today - 90 returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('app_usage_daily', v_n);

  with gone as (delete from public.device_usage_daily where usage_date < v_today - 90 returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_usage_daily', v_n);

  with gone as (delete from public.location_points where recorded_at < now() - interval '90 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('location_points', v_n);

  with gone as (delete from public.device_commands where created_at < now() - interval '30 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_commands', v_n);

  with gone as (delete from public.device_credentials where expires_at < now() - interval '30 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('device_credentials', v_n);

  with gone as (delete from public.pairing_tokens where expires_at < now() - interval '7 days' returning 1)
  select count(*)::int into v_n from gone;
  v_out := v_out || jsonb_build_object('pairing_tokens', v_n);

  return v_out;
end;
$$;
revoke all on function public.retention_run() from public, anon, authenticated;
grant execute on function public.retention_run() to service_role;
