begin;
select plan(24);

select tables_are('public', array[
  'profiles','families','children','devices','device_tokens','device_credentials','pairing_tokens',
  'device_rules','device_permissions','app_rules','app_usage_daily','device_usage_daily',
  'location_points','geofences','geofence_events','schedules','device_events','device_commands','audit_logs',
  'device_apps','notifications','notification_preferences'
], 'public schema contains exactly the Phase 3 tables plus device_apps (Phase 15a) and the notification tables (Phase 29a)');

-- RLS on every table (deny-by-default)
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every public table has RLS enabled');
select cmp_ok(
  (select count(*)::int from pg_policies where schemaname = 'public'),
  '>', 0, 'RLS policies exist (Phase 4)');

-- anon holds no privileges on any table (authenticated grants are covered by 05_rls)
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0, 'anon has no table grants');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
      and routine_name not in ('is_valid_day_set','is_valid_day_limits','parent_set_screen_time_rules','parent_set_app_rule','parent_save_schedule','parent_delete_schedule','parent_set_device_timezone','parent_list_audit_logs','parent_mark_notifications_read','parent_set_notification_preference','is_timezone_name_format','owns_family','owns_child','owns_device')
      ),
  0, 'anon/authenticated/PUBLIC cannot execute public functions (except CHECK helpers, owns_* helpers, parent RPCs)');
select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and grantee in ('anon','PUBLIC')),
  0, 'anon/PUBLIC cannot execute any public function');

-- future tables inherit the lockdown
create table public.zz_probe (id int);
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'zz_probe' and grantee in ('anon','authenticated')),
  0, 'default privileges: new tables are not granted to anon/authenticated');

-- FK cascade family -> child -> device
select fk_ok('public','children','family_id','public','families','id');
select fk_ok('public','devices','child_id','public','children','id');
select fk_ok('public','device_rules','device_id','public','devices','id');
select fk_ok('public','geofence_events',array['geofence_id','device_id'],'public','geofences',array['id','device_id']);

-- uniques
select col_is_unique('public','profiles',array['email']);
select col_is_unique('public','device_tokens',array['device_id']);
select col_is_unique('public','device_tokens',array['fcm_token']);
select col_is_unique('public','pairing_tokens',array['token_hash']);
select col_is_unique('public','device_credentials',array['refresh_token_hash']);
select col_is_unique('public','app_rules',array['device_id','package_name']);
select col_is_unique('public','app_usage_daily',array['device_id','package_name','usage_date']);
select col_is_unique('public','device_usage_daily',array['device_id','usage_date']);
select col_is_unique('public','device_permissions',array['device_id']);

-- time-series indexes
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='location_points' and indexname='location_points_device_time_idx'), 'index location_points_device_time_idx');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='device_events' and indexname='device_events_device_time_idx'), 'index device_events_device_time_idx');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='audit_logs' and indexname='audit_logs_parent_time_idx'), 'index audit_logs_parent_time_idx');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='device_commands' and indexname='device_commands_pending_idx'), 'index device_commands_pending_idx');

select * from finish();
rollback;
