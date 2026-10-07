-- Phase 14a — permission state sync: the enrolled app reports the OS grant state of the 8 catalog permissions.
-- The stored state is a synchronized *representation* of what the OS said, not proof of it.
-- Rules:
--   * exactly the 8 catalog permissions, every key required, values from the CHECK-listed states;
--   * unchanged state => no state write and no event/audit (only last_verified_at is refreshed, so the parent sees
--     "verified N ago" even when nothing changed);
--   * a changed permission => one PERMISSION_STATE_CHANGED device event per permission ({permission, from, to}) and one
--     PERMISSION_STATE_CHANGED audit row per call listing the changes (no child data, no IP);
--   * never touches device_status / last_seen_at (only the heartbeat is the liveness signal).
-- SECURITY DEFINER, service_role only; the device id comes from the verified JWT, never from the request body.

create or replace function public.device_update_permissions(
  p_device_id uuid,
  p_states    jsonb
)
returns table (o_outcome text, o_changed int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_keys constant text[] := array[
    'camera','microphone','contacts','sms','call_log','location','precise_location','background_location'];
  c_states constant text[] := array['GRANTED','DENIED','REVOKED','RESTRICTED','NOT_AVAILABLE','NOT_REQUESTED'];
  v_key     text;
  v_val     text;
  v_status  text;
  v_parent  uuid;
  v_old     jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_n       int := 0;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_states is null or jsonb_typeof(p_states) <> 'object' then
    raise exception 'states must be an object' using errcode = '22023';
  end if;
  -- exactly the catalog: no missing and no extra keys
  if (select count(*) from jsonb_object_keys(p_states)) <> array_length(c_keys, 1) then
    raise exception 'states must contain exactly the permission catalog' using errcode = '22023';
  end if;
  foreach v_key in array c_keys loop
    if not p_states ? v_key then
      raise exception 'states must contain exactly the permission catalog' using errcode = '22023';
    end if;
    if jsonb_typeof(p_states -> v_key) <> 'string' then
      raise exception 'permission state must be a string' using errcode = '22023';
    end if;
    v_val := p_states ->> v_key;
    if not v_val = any (c_states) then
      raise exception 'unknown permission state' using errcode = '22023';
    end if;
  end loop;

  -- Lock order: devices -> device_permissions (same order as the other device functions).
  select d.enrollment_status, f.parent_id into v_status, v_parent
  from public.devices d
  join public.children c on c.id = d.child_id
  join public.families f on f.id = c.family_id
  where d.id = p_device_id
  for update of d;

  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  select jsonb_build_object(
           'camera', camera_status, 'microphone', microphone_status, 'contacts', contacts_status,
           'sms', sms_status, 'call_log', call_log_status, 'location', location_status,
           'precise_location', precise_location_status, 'background_location', background_location_status)
    into v_old
  from public.device_permissions
  where device_id = p_device_id
  for update;

  if not found then
    -- Defensive: the on_device_created trigger always creates the row.
    insert into public.device_permissions (device_id) values (p_device_id);
    v_old := jsonb_build_object(
      'camera','NOT_REQUESTED','microphone','NOT_REQUESTED','contacts','NOT_REQUESTED','sms','NOT_REQUESTED',
      'call_log','NOT_REQUESTED','location','NOT_REQUESTED','precise_location','NOT_REQUESTED',
      'background_location','NOT_REQUESTED');
  end if;

  foreach v_key in array c_keys loop
    if v_old ->> v_key is distinct from p_states ->> v_key then
      v_n := v_n + 1;
      v_changes := v_changes || jsonb_build_array(
        jsonb_build_object('permission', v_key, 'from', v_old ->> v_key, 'to', p_states ->> v_key));
      insert into public.device_events (device_id, event_type, metadata)
      values (p_device_id, 'PERMISSION_STATE_CHANGED',
              jsonb_build_object('permission', v_key, 'from', v_old ->> v_key, 'to', p_states ->> v_key));
    end if;
  end loop;

  if v_n = 0 then
    -- Nothing changed: only the verification time moves.
    update public.device_permissions set last_verified_at = now() where device_id = p_device_id;
    return query select 'recorded'::text, 0;
    return;
  end if;

  update public.device_permissions
     set camera_status              = p_states ->> 'camera',
         microphone_status          = p_states ->> 'microphone',
         contacts_status            = p_states ->> 'contacts',
         sms_status                 = p_states ->> 'sms',
         call_log_status            = p_states ->> 'call_log',
         location_status            = p_states ->> 'location',
         precise_location_status    = p_states ->> 'precise_location',
         background_location_status = p_states ->> 'background_location',
         last_verified_at           = now()
   where device_id = p_device_id;

  insert into public.audit_logs (parent_id, device_id, action, metadata)
  values (v_parent, p_device_id, 'PERMISSION_STATE_CHANGED', jsonb_build_object('changes', v_changes));

  return query select 'recorded'::text, v_n;
end;
$$;

revoke all on function public.device_update_permissions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.device_update_permissions(uuid, jsonb) to service_role;
