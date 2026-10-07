-- Phase 15a-1 — app inventory (SQL layer): the enrolled app reports the launchable apps installed on the device.
-- Stored per app: package name, display label, version name, system/user flag. NOT stored: icons, install time,
-- usage, permissions, signing data. A parent only ever reads this table; the device is the single writer.
-- Rules:
--   * full replace: every call carries the complete list; rows missing from it are deleted, new ones inserted,
--     changed ones (label / version / system flag) updated, identical ones are not written at all;
--   * count cap 500 (a phone with more launchable apps than that is rejected, never truncated silently);
--   * APP_INSTALLED / APP_UNINSTALLED device events only from the second sync on (the first sync is the baseline,
--     otherwise every pre-installed app would look like an install); more than 20 changes in one call collapse
--     into one event per direction with a count;
--   * devices.apps_synced_at = "inventory last reported" (also set when the list is empty or unchanged);
--   * never touches device_status / last_seen_at (only the heartbeat is the liveness signal); no audit row
--     (APP_* is not in the audit action list of prompt §39 and an inventory report is not a parent action).
-- SECURITY DEFINER, service_role only; the device id comes from the verified JWT, never from the request body.

alter table public.devices
  add column apps_synced_at timestamptz;

create table public.device_apps (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices (id) on delete cascade,
  package_name  text not null check (
                  char_length(package_name) <= 255
                  and package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'),
  label         text not null check (
                  char_length(label) between 1 and 200
                  and label = btrim(label)
                  and label !~ '[[:cntrl:]]'),
  version_name  text check (
                  char_length(version_name) between 1 and 100
                  and version_name = btrim(version_name)
                  and version_name !~ '[[:cntrl:]]'),
  is_system     boolean not null default false,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (device_id, package_name)
);

create trigger device_apps_updated_at before update on public.device_apps
  for each row execute function public.set_updated_at();

alter table public.device_apps enable row level security;

-- Parent: read-only mirror of what the device reported (no insert / update / delete grant).
grant select on public.device_apps to authenticated;
create policy device_apps_select_own on public.device_apps for select to authenticated
  using (public.owns_device(device_id));

-- Replace the stored inventory of one device with the reported one.
--   p_apps : JSON array, at most 500 elements, each exactly
--            {"package_name": text, "label": text, "version_name": text|null, "is_system": boolean}
--            (no duplicate package names; label trimmed and 1..200 chars; version null or 1..100 chars;
--            no control characters).
--   'recorded' : the stored list now equals p_apps; counts say what changed.
--   'inactive' : unknown device or not ENROLLED -> nothing is written (Edge answers the usual 401).
-- Invalid input raises 22023.
create or replace function public.device_sync_apps(
  p_device_id uuid,
  p_apps      jsonb
)
returns table (o_outcome text, o_added int, o_updated int, o_removed int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max     constant int := 500;
  c_ev_cap  constant int := 20;
  v_el      jsonb;
  v_pkg     text;
  v_label   text;
  v_ver     text;
  v_status  text;
  v_synced  timestamptz;
  v_added   text[];
  v_removed text[];
  v_updated text[];
  v_pk      text;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_apps is null or jsonb_typeof(p_apps) <> 'array' then
    raise exception 'apps must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_apps) > c_max then
    raise exception 'too many apps' using errcode = '22023';
  end if;

  for v_el in select e from jsonb_array_elements(p_apps) as t(e) loop
    if jsonb_typeof(v_el) <> 'object'
       or (select count(*) from jsonb_object_keys(v_el)) <> 4
       or not (v_el ? 'package_name' and v_el ? 'label' and v_el ? 'version_name' and v_el ? 'is_system') then
      raise exception 'app entry must have exactly package_name, label, version_name, is_system' using errcode = '22023';
    end if;
    if jsonb_typeof(v_el -> 'package_name') <> 'string'
       or jsonb_typeof(v_el -> 'label') <> 'string'
       or jsonb_typeof(v_el -> 'is_system') <> 'boolean'
       or jsonb_typeof(v_el -> 'version_name') not in ('string', 'null') then
      raise exception 'app entry has a wrong field type' using errcode = '22023';
    end if;
    v_pkg   := v_el ->> 'package_name';
    v_label := btrim(v_el ->> 'label');
    v_ver   := v_el ->> 'version_name';
    if char_length(v_pkg) > 255 or v_pkg !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' then
      raise exception 'invalid package name' using errcode = '22023';
    end if;
    if char_length(v_label) not between 1 and 200 or v_label ~ '[[:cntrl:]]' then
      raise exception 'invalid app label' using errcode = '22023';
    end if;
    if v_ver is not null
       and (char_length(v_ver) not between 1 and 100 or v_ver <> btrim(v_ver) or v_ver ~ '[[:cntrl:]]') then
      raise exception 'invalid version name' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct e ->> 'package_name') from jsonb_array_elements(p_apps) as t(e))
       <> jsonb_array_length(p_apps) then
    raise exception 'duplicate package name' using errcode = '22023';
  end if;

  -- Lock order: devices -> device_apps (same order as the other device functions).
  select d.enrollment_status, d.apps_synced_at into v_status, v_synced
  from public.devices d
  where d.id = p_device_id
  for update of d;

  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0, 0, 0;
    return;
  end if;

  with incoming as (
    select x.package_name, btrim(x.label) as label, x.version_name, x.is_system
    from jsonb_to_recordset(p_apps) as x(package_name text, label text, version_name text, is_system boolean)
  ),
  del as (
    delete from public.device_apps a
    where a.device_id = p_device_id
      and not exists (select 1 from incoming i where i.package_name = a.package_name)
    returning a.package_name
  )
  select coalesce(array_agg(package_name order by package_name), '{}') into v_removed from del;

  with incoming as (
    select x.package_name, btrim(x.label) as label, x.version_name, x.is_system
    from jsonb_to_recordset(p_apps) as x(package_name text, label text, version_name text, is_system boolean)
  ),
  upd as (
    update public.device_apps a
       set label = i.label, version_name = i.version_name, is_system = i.is_system
      from incoming i
     where a.device_id = p_device_id
       and a.package_name = i.package_name
       and (a.label, a.version_name, a.is_system) is distinct from (i.label, i.version_name, i.is_system)
    returning a.package_name
  )
  select coalesce(array_agg(package_name order by package_name), '{}') into v_updated from upd;

  with incoming as (
    select x.package_name, btrim(x.label) as label, x.version_name, x.is_system
    from jsonb_to_recordset(p_apps) as x(package_name text, label text, version_name text, is_system boolean)
  ),
  ins as (
    insert into public.device_apps (device_id, package_name, label, version_name, is_system)
    select p_device_id, i.package_name, i.label, i.version_name, i.is_system
    from incoming i
    where not exists (
      select 1 from public.device_apps a where a.device_id = p_device_id and a.package_name = i.package_name)
    returning package_name
  )
  select coalesce(array_agg(package_name order by package_name), '{}') into v_added from ins;

  -- Events: not on the very first report (baseline), one per package up to the cap, else one summary per direction.
  if v_synced is not null then
    if cardinality(v_added) between 1 and c_ev_cap then
      foreach v_pk in array v_added loop
        insert into public.device_events (device_id, event_type, metadata)
        values (p_device_id, 'APP_INSTALLED', jsonb_build_object('package_name', v_pk));
      end loop;
    elsif cardinality(v_added) > c_ev_cap then
      insert into public.device_events (device_id, event_type, metadata)
      values (p_device_id, 'APP_INSTALLED', jsonb_build_object('count', cardinality(v_added)));
    end if;
    if cardinality(v_removed) between 1 and c_ev_cap then
      foreach v_pk in array v_removed loop
        insert into public.device_events (device_id, event_type, metadata)
        values (p_device_id, 'APP_UNINSTALLED', jsonb_build_object('package_name', v_pk));
      end loop;
    elsif cardinality(v_removed) > c_ev_cap then
      insert into public.device_events (device_id, event_type, metadata)
      values (p_device_id, 'APP_UNINSTALLED', jsonb_build_object('count', cardinality(v_removed)));
    end if;
  end if;

  update public.devices set apps_synced_at = now() where id = p_device_id;

  return query select 'recorded'::text, cardinality(v_added), cardinality(v_updated), cardinality(v_removed);
end;
$$;

revoke all on function public.device_sync_apps(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.device_sync_apps(uuid, jsonb) to service_role;
