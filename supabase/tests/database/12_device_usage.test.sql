begin;
select plan(84);

-- Fixture: family A (A1 ENROLLED, A2 REVOKED, A3 PENDING) and family B (B1 ENROLLED, already holding usage) --------
insert into auth.users (id,email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.test');
insert into public.families (id,parent_id,name) values
  ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A'),
  ('f0000000-0000-4000-8000-00000000000b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fam B');
insert into public.children (id,family_id,name) values
  ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A'),
  ('c0000000-0000-4000-8000-00000000000b','f0000000-0000-4000-8000-00000000000b','Kid B');
insert into public.devices (id,child_id,device_name,enrollment_status) values
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','A1','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','A2','REVOKED'),
  ('d0000000-0000-4000-8000-0000000000a3','c0000000-0000-4000-8000-00000000000a','A3','PENDING'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');
insert into public.device_usage_daily (device_id,usage_date,total_screen_minutes,unlock_count) values
  ('d0000000-0000-4000-8000-0000000000b1', current_date, 77, 7);
insert into public.app_usage_daily (device_id,package_name,usage_date,foreground_minutes,launch_count) values
  ('d0000000-0000-4000-8000-0000000000b1','com.b.app', current_date, 55, 5);

create function pg_temp.a(pkg text, fg int, launches int) returns jsonb language sql as $$
  select jsonb_build_object('package_name',pkg,'foreground_minutes',fg,'launch_count',launches) $$;
create function pg_temp.u(total int, unlocks int, apps jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('total_screen_minutes',total,'unlock_count',unlocks,'apps',apps) $$;
create function pg_temp.many(n int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(pg_temp.a('com.gen.app' || g, 1, 1) order by g), '[]'::jsonb) from generate_series(1, n) g $$;

-- structure and privileges ----------------------------------------------------------------------------------------
select has_column('public','devices','usage_synced_at','devices.usage_synced_at exists');
select ok(has_function_privilege('service_role','public.device_upload_usage(uuid,date,jsonb)','execute'), 'service_role can execute device_upload_usage');
select ok(not has_function_privilege('authenticated','public.device_upload_usage(uuid,date,jsonb)','execute'), 'authenticated cannot execute device_upload_usage');
select ok(not has_function_privilege('anon','public.device_upload_usage(uuid,date,jsonb)','execute'), 'anon cannot execute device_upload_usage');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='device_upload_usage'), 'device_upload_usage is SECURITY DEFINER with an empty search_path');
select is((select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='device_usage_daily' and grantee='authenticated'), 'DELETE,SELECT', 'authenticated holds SELECT + DELETE only on device_usage_daily');
select is((select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='app_usage_daily' and grantee='authenticated'), 'DELETE,SELECT', 'authenticated holds SELECT + DELETE only on app_usage_daily');
select is((select count(*)::int from public.devices where usage_synced_at is not null), 0, 'new devices have no usage timestamp');

-- validation: every rejection is 22023 and writes nothing -----------------------------------------------------------
set local role service_role;
select throws_ok($$select * from public.device_upload_usage(null, current_date, pg_temp.u(1,1))$$, '22023', null, 'NULL device id is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', null, pg_temp.u(1,1))$$, '22023', null, 'NULL day is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, null)$$, '22023', null, 'NULL usage is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, '[]'::jsonb)$$, '22023', null, 'array instead of object is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date - 15, pg_temp.u(1,1))$$, '22023', null, 'day 15 days back is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date + 2, pg_temp.u(1,1))$$, '22023', null, 'day 2 days ahead is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) - 'unlock_count')$$, '22023', null, 'missing key is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"extra":1}')$$, '22023', null, 'extra key is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, (pg_temp.u(1,1) - 'unlock_count') || '{"x":1}')$$, '22023', null, 'swapped key (same count) is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"total_screen_minutes":"5"}')$$, '22023', null, 'string total is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"total_screen_minutes":5.5}')$$, '22023', null, 'fractional total is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"total_screen_minutes":5.0}')$$, '22023', null, '5.0 is not an integer');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"total_screen_minutes":-1}')$$, '22023', null, 'negative total is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1441,1))$$, '22023', null, 'total above 1440 is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,10001))$$, '22023', null, 'unlock count above 10000 is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"unlock_count":null}')$$, '22023', null, 'null unlock count is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1) || '{"apps":{}}')$$, '22023', null, 'apps object instead of array is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, pg_temp.many(201)))$$, '22023', null, '201 apps are rejected (cap 200)');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1,1) - 'launch_count')))$$, '22023', null, 'app entry with a missing key is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1,1) || '{"label":"x"}')))$$, '22023', null, 'app entry with an extra key is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1,1) || '{"package_name":5}')))$$, '22023', null, 'numeric package name is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('nodots',1,1))))$$, '22023', null, 'package name without a dot is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('1com.a.app',1,1))))$$, '22023', null, 'package name starting with a digit is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.' || repeat('a', 252),1,1))))$$, '22023', null, '256-char package name is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1441,1))))$$, '22023', null, 'app minutes above 1440 are rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',-1,1))))$$, '22023', null, 'negative app minutes are rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1,10001))))$$, '22023', null, 'launch count above 10000 is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1,1), pg_temp.a('com.a.app',2,2))))$$, '22023', null, 'duplicate package name is rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.a.app',1000,1), pg_temp.a('com.b.app',441,1))))$$, '22023', null, 'app minutes summing above one day are rejected');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1, jsonb_build_array(pg_temp.a('com.ok.app',1,1), pg_temp.a('bad',1,1))))$$, '22023', null, 'one bad entry rejects the whole report');
reset role;
select is((select count(*)::int from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'rejected calls stored no device usage');
select is((select count(*)::int from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'rejected calls stored no app usage');
select is((select usage_synced_at from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), null, 'rejected calls did not set usage_synced_at');

-- inactive devices: nothing written -------------------------------------------------------------------------------------
set local role service_role;
select results_eq($$select o_outcome, o_apps from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a2', current_date, pg_temp.u(5,5, jsonb_build_array(pg_temp.a('com.a.app',5,5))))$$, $$values ('inactive'::text, 0)$$, 'REVOKED device -> inactive');
select results_eq($$select o_outcome, o_apps from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a3', current_date, pg_temp.u(5,5))$$, $$values ('inactive'::text, 0)$$, 'PENDING device -> inactive');
select results_eq($$select o_outcome, o_apps from public.device_upload_usage('d0000000-0000-4000-8000-00000000ffff', current_date, pg_temp.u(5,5))$$, $$values ('inactive'::text, 0)$$, 'unknown device -> inactive');
reset role;
select is((select count(*)::int from public.device_usage_daily where device_id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3')), 0, 'inactive devices stored nothing');
select is((select usage_synced_at from public.devices where id='d0000000-0000-4000-8000-0000000000a2'), null, 'inactive device: usage_synced_at stays NULL');

-- first report -------------------------------------------------------------------------------------------------------------
select is((select last_seen_at from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), null, 'precondition: A1 has no last_seen_at');
set local role service_role;
select results_eq($$select o_outcome, o_apps from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(120, 15, jsonb_build_array(pg_temp.a('com.a.one',70,6), pg_temp.a('com.a.two',30,4))))$$, $$values ('recorded'::text, 2)$$, 'first report -> recorded with 2 apps');
reset role;
select results_eq($$select total_screen_minutes, unlock_count from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1' and usage_date=current_date$$, $$values (120, 15)$$, 'device totals stored');
select results_eq($$select package_name, foreground_minutes, launch_count from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1' and usage_date=current_date order by package_name$$, $$values ('com.a.one'::text, 70, 6), ('com.a.two'::text, 30, 4)$$, 'per-app rows stored');
select isnt((select usage_synced_at from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), null, 'usage_synced_at is set');
select is((select last_seen_at from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), null, 'a usage report does not set last_seen_at');
select is((select device_status from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), 'UNKNOWN', 'a usage report does not change device_status');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'no device event is written');
select is((select count(*)::int from public.audit_logs), 0, 'no audit row is written');

-- idempotent merge (GREATEST, never delete) -----------------------------------------------------------------------------
set local role service_role;
select results_eq($$select o_outcome from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(120, 15, jsonb_build_array(pg_temp.a('com.a.one',70,6), pg_temp.a('com.a.two',30,4))))$$, $$values ('recorded'::text)$$, 'the identical report again -> recorded');
reset role;
select is((select count(*)::int from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 2, 'identical repeat creates no extra rows');
select is((select count(*)::int from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 1, 'identical repeat keeps one device row per day');
set local role service_role;
select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(150, 20, jsonb_build_array(pg_temp.a('com.a.one',90,8), pg_temp.a('com.a.three',10,1))));
reset role;
select results_eq($$select total_screen_minutes, unlock_count from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1' and usage_date=current_date$$, $$values (150, 20)$$, 'a later report with larger numbers raises the totals');
select results_eq($$select package_name, foreground_minutes, launch_count from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1' and usage_date=current_date order by package_name$$, $$values ('com.a.one'::text, 90, 8), ('com.a.three'::text, 10, 1), ('com.a.two'::text, 30, 4)$$, 'larger values win, new apps are added, an app missing from the report is kept');
set local role service_role;
select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(100, 10, jsonb_build_array(pg_temp.a('com.a.one',50,2))));
reset role;
select results_eq($$select total_screen_minutes, unlock_count from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1' and usage_date=current_date$$, $$values (150, 20)$$, 'a stale (smaller) report never lowers the device totals');
select results_eq($$select foreground_minutes, launch_count from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1' and usage_date=current_date and package_name='com.a.one'$$, $$values (90, 8)$$, 'a stale (smaller) report never lowers an app row');
set local role service_role;
select results_eq($$select o_outcome, o_apps from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(150, 20))$$, $$values ('recorded'::text, 0)$$, 'an empty app list is valid');
reset role;
select is((select count(*)::int from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 3, 'an empty app list deletes nothing');

-- day handling -------------------------------------------------------------------------------------------------------------
set local role service_role;
select results_eq($$select o_outcome from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date - 14, pg_temp.u(60, 5, jsonb_build_array(pg_temp.a('com.a.one',60,5))))$$, $$values ('recorded'::text)$$, 'a day 14 days back is accepted (catch-up after being offline)');
select results_eq($$select o_outcome from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date + 1, pg_temp.u(1, 1))$$, $$values ('recorded'::text)$$, 'tomorrow is accepted (time-zone slack)');
select results_eq($$select o_outcome from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1440, 10000, jsonb_build_array(pg_temp.a('com.max.app',1440,10000))))$$, $$values ('recorded'::text)$$, 'the upper bounds themselves are accepted (1440 min, 10000 counts)');
select results_eq($$select o_outcome, o_apps from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date - 1, pg_temp.u(1, 1, pg_temp.many(200)))$$, $$values ('recorded'::text, 200)$$, 'exactly 200 apps are accepted');
reset role;
select is((select count(*)::int from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 4, 'one device row per distinct day (today, -14, +1, -1)');

-- other family untouched ---------------------------------------------------------------------------------------------------
select results_eq($$select total_screen_minutes, unlock_count from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000b1'$$, $$values (77, 7)$$, 'family B device usage is untouched');
select results_eq($$select foreground_minutes, launch_count from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000b1'$$, $$values (55, 5)$$, 'family B app usage is untouched');
select is((select usage_synced_at from public.devices where id='d0000000-0000-4000-8000-0000000000b1'), null, 'family B usage_synced_at is untouched');

-- parents ---------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select is((select count(*)::int from public.device_usage_daily), 4, 'parent A reads its own device usage rows');
select is((select count(*)::int from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000b1'), 0, 'parent A cannot read family B device usage');
select is((select count(*)::int from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000b1'), 0, 'parent A cannot read family B app usage');
select throws_ok($$insert into public.device_usage_daily (device_id,usage_date,total_screen_minutes) values ('d0000000-0000-4000-8000-0000000000a1', current_date - 3, 5)$$, '42501', null, 'parent cannot insert device usage');
select throws_ok($$update public.device_usage_daily set total_screen_minutes = 0 where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot update device usage');
select throws_ok($$update public.devices set usage_synced_at = now() where id='d0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write usage_synced_at');
select throws_ok($$select * from public.device_upload_usage('d0000000-0000-4000-8000-0000000000a1', current_date, pg_temp.u(1,1))$$, '42501', null, 'parent cannot call device_upload_usage');
reset role;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select results_eq($$select count(*)::int, (count(*) filter (where device_id = 'd0000000-0000-4000-8000-0000000000a1'))::int from public.device_usage_daily$$, $$values (1, 0)$$, 'B sees its 1 usage row and none of A''s');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.app_usage_daily$$, '42501', null, 'anon cannot read app_usage_daily');
reset role;

-- a device principal (sub = device id) never reaches the tables through RLS
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select is((select count(*)::int from public.device_usage_daily), 0, 'a device-id subject sees no rows');
reset role;

-- cascade ------------------------------------------------------------------------------------------------------------------------
delete from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.device_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'deleting a device deletes its device usage');
select is((select count(*)::int from public.app_usage_daily where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'deleting a device deletes its app usage');

select * from finish();
rollback;
