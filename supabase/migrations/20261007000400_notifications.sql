-- 29a-1 — parent notifications (prompt §49): the table, the per-type preferences and the parent RPCs.
-- Producers (29a-2) write rows through an internal SECURITY DEFINER function; parents can only READ their rows and
-- change them through the two RPCs below (mark read, set a preference). Rows carry a type, an optional device and a
-- tiny whitelisted `metadata` object — never coordinates, package names, labels or any child content.
--
-- Types (prompt §49) — keep in sync with `packages/contracts/src/notifications.ts` (a drift test compares them):
--   DEVICE_OFFLINE, BATTERY_LOW, EMERGENCY, GEOFENCE_ENTER, GEOFENCE_EXIT, PERMISSION_REVOKED, LIMIT_REACHED,
--   BLOCKED_APP_ATTEMPT, DEVICE_ENROLLED, SECURITY_EVENT

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  device_id  uuid references public.devices (id) on delete cascade,
  type       text not null check (type in (
               'DEVICE_OFFLINE','BATTERY_LOW','EMERGENCY','GEOFENCE_ENTER','GEOFENCE_EXIT','PERMISSION_REVOKED',
               'LIMIT_REACHED','BLOCKED_APP_ATTEMPT','DEVICE_ENROLLED','SECURITY_EVENT')),
  metadata   jsonb not null default '{}'::jsonb
               check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  check (read_at is null or read_at >= created_at)
);
create index notifications_parent_time_idx on public.notifications (parent_id, created_at desc, id desc);
create index notifications_unread_idx on public.notifications (parent_id) where read_at is null;
create index notifications_created_idx on public.notifications (created_at); -- retention purge (90 d)

-- A missing row means "enabled": a parent only ever stores what they changed.
create table public.notification_preferences (
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in (
               'DEVICE_OFFLINE','BATTERY_LOW','EMERGENCY','GEOFENCE_ENTER','GEOFENCE_EXIT','PERMISSION_REVOKED',
               'LIMIT_REACHED','BLOCKED_APP_ATTEMPT','DEVICE_ENROLLED','SECURITY_EVENT')),
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (parent_id, type)
);

alter table public.notifications            enable row level security;
alter table public.notification_preferences enable row level security;

-- Read own; everything else only through the RPCs / the service role.
grant select on public.notifications            to authenticated;
grant select on public.notification_preferences to authenticated;
create policy notifications_select_own on public.notifications for select to authenticated
  using (parent_id = (select auth.uid()));
create policy notification_preferences_select_own on public.notification_preferences for select to authenticated
  using (parent_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------------
-- Mark as read. NULL = every unread notification of the caller; otherwise only the caller's rows among the ids (a foreign
-- id is silently ignored, same as a missing one). At most 200 ids. Returns how many rows changed.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.parent_mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (select auth.uid());
  v_n      int;
begin
  if v_parent is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_ids is not null and cardinality(p_ids) > 200 then
    raise exception 'too many ids' using errcode = '22023';
  end if;

  with changed as (
    update public.notifications n
       set read_at = greatest(now(), n.created_at)
     where n.parent_id = v_parent
       and n.read_at is null
       and (p_ids is null or n.id = any (p_ids))
    returning 1
  )
  select count(*)::int into v_n from changed;
  return v_n;
end;
$$;
revoke all on function public.parent_mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.parent_mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Preferences: 'updated' | 'unchanged'. A type that was never stored counts as enabled.
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

-- ---------------------------------------------------------------------------------------------------------------------
-- Retention: notifications older than 90 days. service_role only; returns how many rows were deleted.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.notifications_purge_expired()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with gone as (
    delete from public.notifications where created_at < now() - interval '90 days' returning 1
  )
  select count(*)::int into v_n from gone;
  return v_n;
end;
$$;
revoke all on function public.notifications_purge_expired() from public, anon, authenticated;
grant execute on function public.notifications_purge_expired() to service_role;
