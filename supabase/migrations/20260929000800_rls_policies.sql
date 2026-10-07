-- Phase 4 — RLS policies + minimal grants for `authenticated` (parents).
--
-- Model: profiles.id = auth.uid() → families → children → devices → device data.
--  * anon: nothing (no grants, no policies).
--  * authenticated: only what is granted below, column-level where writes are restricted.
--  * device_tokens / device_credentials / pairing_tokens: RLS on, NO policy, NO grant
--    (service_role / Edge Functions only). FCM tokens and credential hashes are unreadable.
--  * Device-originated data (status, battery, permissions, usage, location, events) is
--    written by Edge Functions with service_role; parents get read-only access.
--  * audit_logs: parent may read own rows; inserts only via service_role.
-- service_role bypasses RLS and is unaffected.

-- Ownership helpers -----------------------------------------------------------
-- security definer + empty search_path: they read families/children/devices without
-- recursive RLS. They only ever answer "does auth.uid() own X?", so exposing them to
-- `authenticated` leaks nothing.
create or replace function public.owns_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.families f
    where f.id = p_family_id and f.parent_id = (select auth.uid())
  );
$$;

create or replace function public.owns_child(p_child_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.children c
    join public.families f on f.id = c.family_id
    where c.id = p_child_id and f.parent_id = (select auth.uid())
  );
$$;

create or replace function public.owns_device(p_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.devices d
    join public.children c on c.id = d.child_id
    join public.families f on f.id = c.family_id
    where d.id = p_device_id and f.parent_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_family(uuid) from public, anon, authenticated;
revoke all on function public.owns_child(uuid)  from public, anon, authenticated;
revoke all on function public.owns_device(uuid) from public, anon, authenticated;
grant execute on function public.owns_family(uuid) to authenticated;
grant execute on function public.owns_child(uuid)  to authenticated;
grant execute on function public.owns_device(uuid) to authenticated;

-- profiles: own row; only name/avatar editable (email is synced from auth.users) --------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- families: own rows; parent_id is set on insert and immutable ---------------------------
grant select, delete on public.families to authenticated;
grant insert (parent_id, name) on public.families to authenticated;
grant update (name) on public.families to authenticated;
create policy families_select_own on public.families for select to authenticated
  using (parent_id = (select auth.uid()));
create policy families_insert_own on public.families for insert to authenticated
  with check (parent_id = (select auth.uid()));
create policy families_update_own on public.families for update to authenticated
  using (parent_id = (select auth.uid())) with check (parent_id = (select auth.uid()));
create policy families_delete_own on public.families for delete to authenticated
  using (parent_id = (select auth.uid()));

-- children: family_id is set on insert and immutable (cannot be moved to another family) ---
grant select, delete on public.children to authenticated;
grant insert (family_id, name, date_of_birth, avatar_url) on public.children to authenticated;
grant update (name, date_of_birth, avatar_url) on public.children to authenticated;
create policy children_select_own on public.children for select to authenticated
  using (public.owns_family(family_id));
create policy children_insert_own on public.children for insert to authenticated
  with check (public.owns_family(family_id));
create policy children_update_own on public.children for update to authenticated
  using (public.owns_family(family_id)) with check (public.owns_family(family_id));
create policy children_delete_own on public.children for delete to authenticated
  using (public.owns_family(family_id));

-- devices: read + rename only. Creation/enrollment/revocation/removal = Edge Functions
-- (audited, credentials revoked, FCM notified). Status/battery/etc. are device-reported. -----
grant select on public.devices to authenticated;
grant update (device_name) on public.devices to authenticated;
create policy devices_select_own on public.devices for select to authenticated
  using (public.owns_child(child_id));
create policy devices_update_own on public.devices for update to authenticated
  using (public.owns_child(child_id)) with check (public.owns_child(child_id));

-- device_rules: parent-configurable, row created by trigger (no insert/delete) -----------------
grant select on public.device_rules to authenticated;
grant update (daily_screen_limit_minutes, bedtime_enabled, bedtime_start, bedtime_end,
              school_mode_enabled, location_enabled, location_history_enabled, geofence_enabled)
  on public.device_rules to authenticated;
create policy device_rules_select_own on public.device_rules for select to authenticated
  using (public.owns_device(device_id));
create policy device_rules_update_own on public.device_rules for update to authenticated
  using (public.owns_device(device_id)) with check (public.owns_device(device_id));

-- device_permissions: read-only mirror of OS state (device is the source; not proof) ------------
grant select on public.device_permissions to authenticated;
create policy device_permissions_select_own on public.device_permissions for select to authenticated
  using (public.owns_device(device_id));

-- app_rules: parent CRUD; identity (device_id, package_name) immutable -------------------------
grant select, delete on public.app_rules to authenticated;
grant insert (device_id, package_name, app_name, blocked, daily_limit_minutes) on public.app_rules to authenticated;
grant update (blocked, daily_limit_minutes) on public.app_rules to authenticated;
create policy app_rules_select_own on public.app_rules for select to authenticated
  using (public.owns_device(device_id));
create policy app_rules_insert_own on public.app_rules for insert to authenticated
  with check (public.owns_device(device_id));
create policy app_rules_update_own on public.app_rules for update to authenticated
  using (public.owns_device(device_id)) with check (public.owns_device(device_id));
create policy app_rules_delete_own on public.app_rules for delete to authenticated
  using (public.owns_device(device_id));

-- schedules: parent CRUD; device_id immutable ---------------------------------------------------
grant select, delete on public.schedules to authenticated;
grant insert (device_id, name, type, start_time, end_time, days, enabled) on public.schedules to authenticated;
grant update (name, type, start_time, end_time, days, enabled) on public.schedules to authenticated;
create policy schedules_select_own on public.schedules for select to authenticated
  using (public.owns_device(device_id));
create policy schedules_insert_own on public.schedules for insert to authenticated
  with check (public.owns_device(device_id));
create policy schedules_update_own on public.schedules for update to authenticated
  using (public.owns_device(device_id)) with check (public.owns_device(device_id));
create policy schedules_delete_own on public.schedules for delete to authenticated
  using (public.owns_device(device_id));

-- geofences: parent CRUD; device_id immutable ----------------------------------------------------
grant select, delete on public.geofences to authenticated;
grant insert (device_id, name, latitude, longitude, radius_meters, enabled) on public.geofences to authenticated;
grant update (name, latitude, longitude, radius_meters, enabled) on public.geofences to authenticated;
create policy geofences_select_own on public.geofences for select to authenticated
  using (public.owns_device(device_id));
create policy geofences_insert_own on public.geofences for insert to authenticated
  with check (public.owns_device(device_id));
create policy geofences_update_own on public.geofences for update to authenticated
  using (public.owns_device(device_id)) with check (public.owns_device(device_id));
create policy geofences_delete_own on public.geofences for delete to authenticated
  using (public.owns_device(device_id));

-- Device-reported history: parent may read and delete (privacy: "delete child's historical
-- data"); never insert/update — only the device (via Edge Functions) writes these. -------------
grant select, delete on public.app_usage_daily    to authenticated;
grant select, delete on public.device_usage_daily to authenticated;
grant select, delete on public.location_points    to authenticated;
grant select, delete on public.geofence_events    to authenticated;
grant select, delete on public.device_events      to authenticated;

create policy app_usage_daily_select_own on public.app_usage_daily for select to authenticated
  using (public.owns_device(device_id));
create policy app_usage_daily_delete_own on public.app_usage_daily for delete to authenticated
  using (public.owns_device(device_id));
create policy device_usage_daily_select_own on public.device_usage_daily for select to authenticated
  using (public.owns_device(device_id));
create policy device_usage_daily_delete_own on public.device_usage_daily for delete to authenticated
  using (public.owns_device(device_id));
create policy location_points_select_own on public.location_points for select to authenticated
  using (public.owns_device(device_id));
create policy location_points_delete_own on public.location_points for delete to authenticated
  using (public.owns_device(device_id));
create policy geofence_events_select_own on public.geofence_events for select to authenticated
  using (public.owns_device(device_id));
create policy geofence_events_delete_own on public.geofence_events for delete to authenticated
  using (public.owns_device(device_id));
create policy device_events_select_own on public.device_events for select to authenticated
  using (public.owns_device(device_id));
create policy device_events_delete_own on public.device_events for delete to authenticated
  using (public.owns_device(device_id));

-- device_commands: read + insert PENDING only. Column grant excludes status/executed_at/created_at
-- (they take defaults), the policy re-asserts PENDING and bounds expiry to (now, now + 24 h].
-- No update/delete: state transitions belong to the device API (service_role). ------------------
grant select on public.device_commands to authenticated;
grant insert (device_id, command_type, payload, expires_at) on public.device_commands to authenticated;
create policy device_commands_select_own on public.device_commands for select to authenticated
  using (public.owns_device(device_id));
create policy device_commands_insert_pending on public.device_commands for insert to authenticated
  with check (
    public.owns_device(device_id)
    and status = 'PENDING'
    and executed_at is null
    and expires_at > now()
    and expires_at <= now() + interval '24 hours'
  );

-- audit_logs: read own; append-only via service_role -----------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_logs_select_own on public.audit_logs for select to authenticated
  using (parent_id = (select auth.uid()));

-- device_tokens, device_credentials, pairing_tokens: intentionally NO policy and NO grant. ----------

-- Guard: fail the migration if a table is left without a policy by accident, or any policy is
-- not scoped to `authenticated`.
do $$
declare v text;
begin
  select string_agg(c.relname, ', ') into v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname not in ('device_tokens', 'device_credentials', 'pairing_tokens')
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  if v is not null then raise exception 'tables without RLS policy: %', v; end if;

  select string_agg(p.tablename || '.' || p.policyname, ', ') into v
  from pg_policies p
  where p.schemaname = 'public' and p.roles <> array['authenticated']::name[];
  if v is not null then raise exception 'policies not restricted to authenticated: %', v; end if;

  if exists (select 1 from pg_policies p where p.schemaname = 'public'
             and p.tablename in ('device_tokens', 'device_credentials', 'pairing_tokens')) then
    raise exception 'secret tables must have no policies';
  end if;
end $$;
