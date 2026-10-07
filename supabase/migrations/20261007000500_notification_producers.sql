-- 29a-2 — who creates notifications (prompt §49), without touching any of the functions that write the events:
--   * AFTER INSERT trigger on `device_events`  → offline, battery low, blocked-app attempt, geofence enter/exit,
--     limit reached, and "a permission that was granted is now off";
--   * AFTER INSERT trigger on `audit_logs`     → device enrolled, and a security event when a device's credential was
--     reused (the audit row `DEVICE_REMOVED` with reason `credential_reuse`).
-- Both call the internal `notify_parent` (nobody can execute it directly): it finds the owner of the device, honours
-- the parent's preference, drops near-duplicates inside a per-type window and keeps at most 500 notifications per parent.
-- EMERGENCY and SECURITY_EVENT are ALWAYS ON: a stored "off" is ignored and the preference RPC refuses to store one.
-- Metadata is a tiny whitelist (a permission key, a reason); never a package name, label, coordinate or number.

create or replace function public.notify_parent(p_device_id uuid, p_type text, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_window interval;
  v_id     uuid;
begin
  if p_type is null or p_type not in (
       'DEVICE_OFFLINE','BATTERY_LOW','EMERGENCY','GEOFENCE_ENTER','GEOFENCE_EXIT','PERMISSION_REVOKED',
       'LIMIT_REACHED','BLOCKED_APP_ATTEMPT','DEVICE_ENROLLED','SECURITY_EVENT') then
    raise exception 'unknown notification type' using errcode = '22023';
  end if;

  select f.parent_id into v_parent
    from public.devices d
    join public.children c on c.id = d.child_id
    join public.families f on f.id = c.family_id
   where d.id = p_device_id;
  if v_parent is null then
    return null;
  end if;

  if p_type not in ('EMERGENCY', 'SECURITY_EVENT')
     and exists (select 1 from public.notification_preferences p
                  where p.parent_id = v_parent and p.type = p_type and not p.enabled) then
    return null;
  end if;

  v_window := case p_type
                when 'DEVICE_OFFLINE'       then interval '30 minutes'
                when 'BATTERY_LOW'          then interval '6 hours'
                when 'BLOCKED_APP_ATTEMPT'  then interval '10 minutes'
                when 'PERMISSION_REVOKED'   then interval '1 hour'
                when 'LIMIT_REACHED'        then interval '1 hour'
                else interval '0 seconds'
              end;
  if v_window > interval '0 seconds'
     and exists (select 1 from public.notifications n
                  where n.parent_id = v_parent and n.device_id = p_device_id and n.type = p_type
                    and n.created_at > now() - v_window) then
    return null;
  end if;

  insert into public.notifications (parent_id, device_id, type, metadata)
  values (v_parent, p_device_id, p_type, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  -- At most 500 per parent: the oldest go first.
  delete from public.notifications n
   where n.parent_id = v_parent
     and n.id in (select o.id from public.notifications o where o.parent_id = v_parent
                   order by o.created_at desc, o.id desc offset 500);
  return v_id;
end;
$$;
revoke all on function public.notify_parent(uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.device_events_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_meta jsonb := '{}'::jsonb;
  v_perm text;
begin
  case new.event_type
    when 'DEVICE_OFFLINE'       then v_type := 'DEVICE_OFFLINE';
    when 'BATTERY_LOW'          then v_type := 'BATTERY_LOW';
    when 'BLOCKED_APP_ATTEMPT'  then v_type := 'BLOCKED_APP_ATTEMPT';
    when 'GEOFENCE_ENTER'       then v_type := 'GEOFENCE_ENTER';
    when 'GEOFENCE_EXIT'        then v_type := 'GEOFENCE_EXIT';
    when 'LIMIT_REACHED'        then v_type := 'LIMIT_REACHED';
    when 'PERMISSION_STATE_CHANGED' then
      -- Only "was granted, is not any more" counts; a permission that was never granted is not a revocation.
      if new.metadata ->> 'from' = 'GRANTED' and new.metadata ->> 'to' in ('DENIED', 'REVOKED', 'RESTRICTED') then
        v_type := 'PERMISSION_REVOKED';
        v_perm := new.metadata ->> 'permission';
        if v_perm ~ '^[a-z_]{1,32}$' then
          v_meta := jsonb_build_object('permission', v_perm);
        end if;
      end if;
    else
      null;
  end case;

  if v_type is not null then
    perform public.notify_parent(new.device_id, v_type, v_meta);
  end if;
  return null;
end;
$$;
revoke all on function public.device_events_notify() from public, anon, authenticated, service_role;

create trigger device_events_notify
  after insert on public.device_events
  for each row execute function public.device_events_notify();

-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.audit_logs_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.device_id is null then
    return null;
  end if;
  if new.action = 'DEVICE_ENROLLED' then
    perform public.notify_parent(new.device_id, 'DEVICE_ENROLLED', '{}'::jsonb);
  elsif new.action = 'DEVICE_REMOVED' and new.metadata ->> 'reason' = 'credential_reuse' then
    perform public.notify_parent(new.device_id, 'SECURITY_EVENT', jsonb_build_object('reason', 'credential_reuse'));
  end if;
  return null;
end;
$$;
revoke all on function public.audit_logs_notify() from public, anon, authenticated, service_role;

create trigger audit_logs_notify
  after insert on public.audit_logs
  for each row execute function public.audit_logs_notify();

-- ---------------------------------------------------------------------------------------------------------------------
-- 29a-1's preference RPC again, now refusing the two always-on types (everything else unchanged).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.parent_set_notification_preference(p_type text, p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (select auth.uid());
  v_old    boolean;
begin
  if v_parent is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_type is null or p_type not in (
       'DEVICE_OFFLINE','BATTERY_LOW','EMERGENCY','GEOFENCE_ENTER','GEOFENCE_EXIT','PERMISSION_REVOKED',
       'LIMIT_REACHED','BLOCKED_APP_ATTEMPT','DEVICE_ENROLLED','SECURITY_EVENT') then
    raise exception 'unknown notification type' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'enabled flag required' using errcode = '22023';
  end if;
  if p_type in ('EMERGENCY', 'SECURITY_EVENT') and not p_enabled then
    raise exception 'this notification is always on' using errcode = '22023';
  end if;

  select p.enabled into v_old from public.notification_preferences p
   where p.parent_id = v_parent and p.type = p_type;

  if coalesce(v_old, true) = p_enabled then
    return 'unchanged';
  end if;

  insert into public.notification_preferences (parent_id, type, enabled)
  values (v_parent, p_type, p_enabled)
  on conflict (parent_id, type) do update set enabled = excluded.enabled, updated_at = now();
  return 'updated';
end;
$$;
revoke all on function public.parent_set_notification_preference(text, boolean) from public, anon;
grant execute on function public.parent_set_notification_preference(text, boolean) to authenticated;
