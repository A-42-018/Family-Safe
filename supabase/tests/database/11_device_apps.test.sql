begin;
select plan(92);

-- Fixture: family A (A1 ENROLLED, A2 REVOKED, A3 PENDING) and family B (B1 ENROLLED, already holding two apps) -----
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
insert into public.device_apps (device_id,package_name,label,version_name,is_system) values
  ('d0000000-0000-4000-8000-0000000000b1','com.a.app','B app one','1.0',false),
  ('d0000000-0000-4000-8000-0000000000b1','com.b.app','B app two',null,true);

create function pg_temp.app(pkg text, lbl text, ver text default null, sys boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('package_name',pkg,'label',lbl,'version_name',ver,'is_system',sys) $$;
create function pg_temp.many(n int, prefix text default 'com.gen.app') returns jsonb language sql as $$
  select coalesce(jsonb_agg(pg_temp.app(prefix || g, 'Gen ' || g, '1.' || g, false) order by g), '[]'::jsonb) from generate_series(1, n) g $$;

-- structure and privileges ----------------------------------------------------------------------------------------
select has_table('public','device_apps','device_apps exists');
select has_column('public','devices','apps_synced_at','devices.apps_synced_at exists');
select ok(has_function_privilege('service_role','public.device_sync_apps(uuid,jsonb)','execute'), 'service_role can execute device_sync_apps');
select ok(not has_function_privilege('authenticated','public.device_sync_apps(uuid,jsonb)','execute'), 'authenticated cannot execute device_sync_apps');
select ok(not has_function_privilege('anon','public.device_sync_apps(uuid,jsonb)','execute'), 'anon cannot execute device_sync_apps');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='device_sync_apps'), 'device_sync_apps is SECURITY DEFINER with an empty search_path');
select ok((select relrowsecurity from pg_class where oid = 'public.device_apps'::regclass), 'device_apps has RLS enabled');
select is((select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='device_apps' and grantee='authenticated'), 'SELECT', 'authenticated holds SELECT only on device_apps');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='device_apps' and grantee in ('anon','PUBLIC')), 0, 'anon holds nothing on device_apps');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='device_apps' and cmd='SELECT' and roles = array['authenticated']::name[]), 1, 'device_apps has exactly one policy: SELECT for authenticated');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='device_apps'), 1, 'device_apps has no other policy');
select is((select count(*)::int from public.devices where apps_synced_at is not null), 0, 'new devices have no inventory timestamp');

-- table constraints (superuser inserts) -------------------------------------------------------------------------------
select throws_ok($$insert into public.device_apps (device_id,package_name,label) values ('d0000000-0000-4000-8000-0000000000a1','nodots','x')$$, '23514', null, 'CHECK: package name needs a dot');
select throws_ok($$insert into public.device_apps (device_id,package_name,label) values ('d0000000-0000-4000-8000-0000000000a1','com.ok.app',' padded ')$$, '23514', null, 'CHECK: label must be trimmed');
select throws_ok($$insert into public.device_apps (device_id,package_name,label) values ('d0000000-0000-4000-8000-0000000000b1','com.a.app','dup')$$, '23505', null, 'UNIQUE (device_id, package_name)');

-- validation: every rejection is 22023 and writes nothing -----------------------------------------------------------
set local role service_role;
select throws_ok($$select * from public.device_sync_apps(null, '[]'::jsonb)$$, '22023', null, 'NULL device id is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', null)$$, '22023', null, 'NULL apps are rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$, '22023', null, 'object instead of array is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', '"x"'::jsonb)$$, '22023', null, 'scalar is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', '["com.a.app"]'::jsonb)$$, '22023', null, 'array of strings is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', pg_temp.many(501))$$, '22023', null, '501 apps are rejected (cap 500)');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A') - 'is_system'))$$, '22023', null, 'missing key is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A') || '{"icon":"x"}'))$$, '22023', null, 'extra key is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array((pg_temp.app('com.a.app','A') - 'is_system') || '{"installed":true}'))$$, '22023', null, 'swapped key (same count) is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A') || '{"package_name":5}'))$$, '22023', null, 'numeric package name is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A') || '{"label":null}'))$$, '22023', null, 'null label is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A') || '{"is_system":"yes"}'))$$, '22023', null, 'string is_system is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A') || '{"version_name":7}'))$$, '22023', null, 'numeric version is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('nodots','A')))$$, '22023', null, 'package name without a dot is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('1com.a.app','A')))$$, '22023', null, 'package name starting with a digit is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a app','A')))$$, '22023', null, 'package name with a space is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.' || repeat('a', 252),'A')))$$, '22023', null, '256-char package name is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','')))$$, '22023', null, 'empty label is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','   ')))$$, '22023', null, 'blank label is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app', repeat('x', 201))))$$, '22023', null, '201-char label is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app', E'bad\tlabel')))$$, '22023', null, 'label with a control character is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A','')))$$, '22023', null, 'empty version is rejected (null means unknown)');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A', repeat('9', 101))))$$, '22023', null, '101-char version is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A',' 1.0')))$$, '22023', null, 'untrimmed version is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A', E'1.0\n')))$$, '22023', null, 'version with a control character is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.a.app','A'), pg_temp.app('com.a.app','Again')))$$, '22023', null, 'duplicate package name is rejected');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', jsonb_build_array(pg_temp.app('com.ok.app','Fine'), pg_temp.app('bad','Bad')))$$, '22023', null, 'one bad entry rejects the whole list');
reset role;
select is((select count(*)::int from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'rejected calls stored nothing');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'rejected calls wrote no events');
select is((select apps_synced_at from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), null, 'rejected calls did not set apps_synced_at');

-- first sync = baseline: rows stored, no install events ------------------------------------------------------------
set local role service_role;
select is((select o_outcome || ':' || o_added || ':' || o_updated || ':' || o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1',
  jsonb_build_array(pg_temp.app('com.a.app','  Alpha  ','1.0',false), pg_temp.app('com.b.app','Beta',null,true), pg_temp.app('com.c.app','Gamma','2.5.1',false)))),
  'recorded:3:0:0', 'first sync records 3 added');
reset role;
select is((select string_agg(package_name || '|' || label || '|' || coalesce(version_name,'-') || '|' || is_system, ',' order by package_name) from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'),
  'com.a.app|Alpha|1.0|false,com.b.app|Beta|-|true,com.c.app|Gamma|2.5.1|false', 'rows stored (label trimmed, null version kept)');
select ok((select apps_synced_at = now() from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), 'apps_synced_at is set');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'the baseline sync writes no install events');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'an inventory sync writes no audit row');
select is((select device_status || ':' || coalesce(last_seen_at::text,'-') from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), 'UNKNOWN:-', 'sync does not change device_status or last_seen_at');

-- identical sync: nothing written except the device timestamp -------------------------------------------------------
alter table public.device_apps disable trigger device_apps_updated_at;
update public.device_apps set updated_at = now() - interval '1 day', first_seen_at = now() - interval '2 days' where device_id='d0000000-0000-4000-8000-0000000000a1';
alter table public.device_apps enable trigger device_apps_updated_at;
update public.devices set apps_synced_at = now() - interval '1 hour' where id='d0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select o_outcome || ':' || o_added || ':' || o_updated || ':' || o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1',
  jsonb_build_array(pg_temp.app('com.c.app','Gamma','2.5.1',false), pg_temp.app('com.a.app','Alpha','1.0',false), pg_temp.app('com.b.app','Beta',null,true)))),
  'recorded:0:0:0', 'identical sync (different order) reports no change');
reset role;
select is((select count(*)::int from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1' and updated_at < now() - interval '23 hours'), 3, 'identical sync did not rewrite any row');
select ok((select apps_synced_at > now() - interval '1 minute' from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), 'identical sync refreshes apps_synced_at');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'identical sync writes no events');

-- changes: one removed, one added, one version update, one system-flag update ------------------------------------------
set local role service_role;
select is((select o_outcome || ':' || o_added || ':' || o_updated || ':' || o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1',
  jsonb_build_array(pg_temp.app('com.a.app','Alpha','1.1',false), pg_temp.app('com.c.app','Gamma','2.5.1',true), pg_temp.app('com.d.app','Delta','3',false)))),
  'recorded:1:2:1', 'diff = 1 added, 2 updated, 1 removed');
reset role;
select is((select string_agg(package_name || '|' || version_name || '|' || is_system, ',' order by package_name) from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'),
  'com.a.app|1.1|false,com.c.app|2.5.1|true,com.d.app|3|false', 'stored list equals the reported list');
select ok((select updated_at > now() - interval '1 minute' from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.a.app'), 'a changed row moves updated_at');
select ok((select first_seen_at < now() - interval '1 day' from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.a.app'), 'an updated row keeps first_seen_at');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 2, 'one install and one uninstall event');
select is((select metadata::text from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='APP_INSTALLED'), '{"package_name": "com.d.app"}', 'install event carries the package name only');
select is((select metadata::text from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='APP_UNINSTALLED'), '{"package_name": "com.b.app"}', 'uninstall event carries the package name only');

-- empty list removes everything --------------------------------------------------------------------------------------
set local role service_role;
select is((select o_outcome || ':' || o_added || ':' || o_updated || ':' || o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', '[]'::jsonb)), 'recorded:0:0:3', 'an empty list removes all 3');
reset role;
select is((select count(*)::int from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'inventory is empty');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='APP_UNINSTALLED'), 4, 'three more uninstall events (one per package)');

-- event collapsing: 20 = per package, 21 = one summary --------------------------------------------------------------
delete from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select o_added from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', pg_temp.many(20))), 20, '20 apps added');
reset role;
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='APP_INSTALLED' and metadata ? 'package_name'), 20, '20 changes = 20 per-package install events');
delete from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select o_outcome || ':' || o_added || ':' || o_updated || ':' || o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', pg_temp.many(21, 'com.big.app'))), 'recorded:21:0:20', '21 added and 20 removed');
reset role;
select is((select string_agg(metadata::text, ',') from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='APP_INSTALLED'), '{"count": 21}', '21 installs collapse into one counted event');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='APP_UNINSTALLED' and metadata ? 'package_name'), 20, '20 uninstalls stay per package');
delete from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', '[]'::jsonb)), 21, '21 apps removed');
reset role;
select is((select string_agg(event_type || ':' || metadata::text, ',') from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 'APP_UNINSTALLED:{"count": 21}', '21 uninstalls collapse into one counted event');

-- cap boundary: 500 accepted ---------------------------------------------------------------------------------------
set local role service_role;
select is((select o_added from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', pg_temp.many(500, 'com.cap.app'))), 500, '500 apps are accepted');
reset role;
select is((select count(*)::int from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'), 500, '500 rows stored');

-- inactive devices and isolation ----------------------------------------------------------------------------------------
set local role service_role;
select is((select o_outcome || ':' || o_added || ':' || o_updated || ':' || o_removed from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a2', pg_temp.many(2))), 'inactive:0:0:0', 'REVOKED device is inactive');
select is((select o_outcome from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a3', pg_temp.many(2))), 'inactive', 'PENDING device is inactive');
select is((select o_outcome from public.device_sync_apps('99999999-9999-4999-8999-999999999999', pg_temp.many(2))), 'inactive', 'unknown device is inactive');
reset role;
select is((select count(*)::int from public.device_apps where device_id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3')), 0, 'inactive devices store nothing');
select is((select count(*)::int from public.devices where id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3') and apps_synced_at is not null), 0, 'inactive devices get no timestamp');
select is((select count(*)::int from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000b1'), 2, 'family B rows untouched');
select is((select apps_synced_at from public.devices where id='d0000000-0000-4000-8000-0000000000b1'), null, 'family B device untouched');

-- RLS: parent A reads only its own devices'' apps, never writes --------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select results_eq($$select count(*)::int, (count(*) filter (where device_id = 'd0000000-0000-4000-8000-0000000000b1'))::int from public.device_apps$$, $$values (500, 0)$$, 'A sees its 500 apps and none of B''s');
select is((select apps_synced_at is not null from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), true, 'A can read apps_synced_at');
select throws_ok($$insert into public.device_apps (device_id,package_name,label) values ('d0000000-0000-4000-8000-0000000000a1','com.x.app','X')$$, '42501', null, 'parent cannot insert device_apps');
select throws_ok($$update public.device_apps set label='Hacked' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot update device_apps');
select throws_ok($$delete from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot delete device_apps');
select throws_ok($$update public.devices set apps_synced_at = now() where id='d0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write apps_synced_at');
select throws_ok($$select * from public.device_sync_apps('d0000000-0000-4000-8000-0000000000a1', '[]'::jsonb)$$, '42501', null, 'parent cannot call device_sync_apps');
reset role;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select results_eq($$select count(*)::int, (count(*) filter (where device_id = 'd0000000-0000-4000-8000-0000000000a1'))::int from public.device_apps$$, $$values (2, 0)$$, 'B sees its 2 apps and none of A''s');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.device_apps$$, '42501', null, 'anon cannot read device_apps');
reset role;

-- a device principal (sub = device id) never reaches the table through RLS
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select is((select count(*)::int from public.device_apps), 0, 'a device-id subject sees no rows');
reset role;

-- cascade ------------------------------------------------------------------------------------------------------------------
delete from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'deleting a device deletes its apps');

select * from finish();
rollback;
