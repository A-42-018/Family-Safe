begin;
select plan(56);

-- Fixture: family A (A1 ENROLLED, A2 REVOKED, A3 PENDING) and family B (B1 ENROLLED) ---------------------------
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

select has_column('public','devices','sdk_level','devices has sdk_level');
select has_column('public','devices','security_patch','devices has security_patch');
select has_column('public','devices','storage_total_mb','devices has storage_total_mb');
select has_column('public','devices','storage_free_mb','devices has storage_free_mb');
select has_column('public','devices','info_updated_at','devices has info_updated_at');
select col_is_null('public','devices','sdk_level','sdk_level is NULL until the device reports');
select ok(has_function_privilege('service_role','public.device_update_info(uuid,int,date,int,int)','execute'), 'service_role can execute device_update_info');
select ok(not has_function_privilege('authenticated','public.device_update_info(uuid,int,date,int,int)','execute'), 'authenticated cannot execute device_update_info');
select ok(not has_function_privilege('anon','public.device_update_info(uuid,int,date,int,int)','execute'), 'anon cannot execute device_update_info');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='device_update_info'), 'device_update_info is SECURITY DEFINER with an empty search_path');
select throws_ok($$update public.devices set sdk_level = 0 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: sdk_level 0 rejected');
select throws_ok($$update public.devices set sdk_level = 100 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: sdk_level 100 rejected');
select throws_ok($$update public.devices set security_patch = date '2009-12-31' where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: security_patch before 2010 rejected');
select throws_ok($$update public.devices set storage_total_mb = 0, storage_free_mb = 0 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: total storage 0 rejected');
select throws_ok($$update public.devices set storage_total_mb = 16777217, storage_free_mb = 1 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: total storage above ceiling rejected');
select throws_ok($$update public.devices set storage_total_mb = 100, storage_free_mb = -1 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: negative free storage rejected');
select throws_ok($$update public.devices set storage_total_mb = 100 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: total without free rejected');
select throws_ok($$update public.devices set storage_free_mb = 100 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: free without total rejected');
select throws_ok($$update public.devices set storage_total_mb = 100, storage_free_mb = 101 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'CHECK: free above total rejected');
select lives_ok($$update public.devices set storage_total_mb = 100, storage_free_mb = 100 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, 'CHECK: free == total is allowed');
select lives_ok($$update public.devices set storage_total_mb = null, storage_free_mb = null where id = 'd0000000-0000-4000-8000-0000000000a1'$$, 'CHECK: both storage values may be NULL');
set local role service_role;
select throws_ok($$select * from public.device_update_info(null,34,'2026-08-05',128000,64000)$$, '22023', null, 'NULL device id is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',null,'2026-08-05',128000,64000)$$, '22023', null, 'NULL sdk level is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',0,'2026-08-05',128000,64000)$$, '22023', null, 'sdk level 0 is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',100,'2026-08-05',128000,64000)$$, '22023', null, 'sdk level 100 is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2009-12-31',128000,64000)$$, '22023', null, 'ancient security patch is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,current_date + 2,128000,64000)$$, '22023', null, 'security patch more than a day ahead is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,null)$$, '22023', null, 'total without free is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',null,64000)$$, '22023', null, 'free without total is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',0,0)$$, '22023', null, 'zero total storage is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',16777217,1)$$, '22023', null, 'total storage above the ceiling is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,-1)$$, '22023', null, 'negative free storage is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,128001)$$, '22023', null, 'free above total is rejected');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,64000)), 'recorded', 'valid upload is recorded');
reset role;
select is(
  (select row(sdk_level, security_patch, storage_total_mb, storage_free_mb, info_updated_at = now())::text from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'),
  row(34,date '2026-08-05',128000,64000,true)::text, 'device row carries the reported information');
select is((select device_status || ':' || coalesce(last_seen_at::text,'-') from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), 'UNKNOWN:-', 'upload does not change device_status or last_seen_at');
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 0, 'upload writes no device events');
set local role service_role;
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',35,null,null,null)), 'recorded', 'unknown patch and storage (all NULL) are accepted');
reset role;
select is(
  (select row(sdk_level, security_patch, storage_total_mb, storage_free_mb)::text from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'),
  row(35,null::date,null::int,null::int)::text, 'a later upload overwrites everything, NULLs included');
set local role service_role;
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',35,'2026-09-05',128000,128000)), 'recorded', 'free == total is accepted');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',35,(current_date + 1),1,0)), 'recorded', 'patch date one day ahead (timezone slack) is accepted');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a2',34,'2026-08-05',128000,64000)), 'inactive', 'REVOKED device -> inactive');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a3',34,'2026-08-05',128000,64000)), 'inactive', 'PENDING device -> inactive');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000ff',34,'2026-08-05',128000,64000)), 'inactive', 'unknown device -> inactive');
reset role;
select is((select count(*)::int from public.devices where id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3') and (sdk_level is not null or info_updated_at is not null)), 0, 'inactive devices were not written');
select is((select count(*)::int from public.devices where id = 'd0000000-0000-4000-8000-0000000000b1' and (sdk_level is not null or info_updated_at is not null)), 0, 'family B device untouched by uploads for A1');
set local role service_role;
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000b1',31,'2026-01-05',64000,1000)), 'recorded', 'B1 upload is recorded');
reset role;
select is((select sdk_level from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), 35, 'A1 unchanged by the B1 upload');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select is((select count(*)::int from public.devices where sdk_level is not null), 1, 'parent A sees the info columns of own device only (A2/A3 have none, B1 hidden by RLS)');
select is((select storage_total_mb from public.devices where id = 'd0000000-0000-4000-8000-0000000000b1'), null, 'parent A cannot read family B info');
select throws_ok($$update public.devices set sdk_level = 1 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write sdk_level');
select throws_ok($$update public.devices set security_patch = null where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write security_patch');
select throws_ok($$update public.devices set storage_free_mb = 0 where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write storage values');
select throws_ok($$update public.devices set info_updated_at = now() where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write info_updated_at');
select lives_ok($$update public.devices set device_name = 'Renamed' where id = 'd0000000-0000-4000-8000-0000000000a1'$$, 'parent can still rename the device');
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok($$select sdk_level from public.devices$$, '42501', null, 'anon cannot read device info');
reset role;

select * from finish();
rollback;
