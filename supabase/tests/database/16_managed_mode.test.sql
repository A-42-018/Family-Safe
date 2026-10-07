begin;
select plan(34);

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

select has_column('public','devices','managed_mode','devices has managed_mode');
select col_is_null('public','devices','managed_mode','managed_mode is nullable (NULL = not reported yet)');
select is((select count(*)::int from public.devices where managed_mode is not null), 0, 'no device reported managed mode yet');
select ok(not has_function_privilege('anon','public.device_update_info(uuid,int,date,int,int,boolean)','execute'), 'anon cannot execute the 6-argument function');
select ok(not has_function_privilege('authenticated','public.device_update_info(uuid,int,date,int,int,boolean)','execute'), 'authenticated cannot execute the 6-argument function');
select ok(has_function_privilege('service_role','public.device_update_info(uuid,int,date,int,int,boolean)','execute'), 'service_role can execute the 6-argument function');
select is((select prosecdef from pg_proc where oid = 'public.device_update_info(uuid,int,date,int,int,boolean)'::regprocedure), true, 'the 6-argument function is SECURITY DEFINER');
select ok((select proconfig = array['search_path=""'] from pg_proc where oid = 'public.device_update_info(uuid,int,date,int,int,boolean)'::regprocedure), 'the 6-argument function pins an empty search_path');

set local role service_role;
select throws_ok($$select * from public.device_update_info(null,34,'2026-08-05',128000,64000,true)$$, '22023', null, 'NULL device id is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,64000,null)$$, '22023', null, 'NULL managed mode is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',0,'2026-08-05',128000,64000,true)$$, '22023', null, 'sdk level 0 is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,null,true)$$, '22023', null, 'total without free is rejected');
select throws_ok($$select * from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,128001,false)$$, '22023', null, 'free above total is rejected');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,64000,true)), 'recorded', 'managed device upload is recorded');
reset role;
select is(
  (select row(sdk_level, managed_mode, storage_total_mb, info_updated_at = now())::text from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'),
  row(34,true,128000,true)::text, 'device row carries managed_mode = true with the other facts');
select is((select device_status || ':' || coalesce(last_seen_at::text,'-') from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), 'UNKNOWN:-', 'upload does not change device_status or last_seen_at');
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 0, 'upload writes no device events');
set local role service_role;
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',35,null,null,null,false)), 'recorded', 'a later upload with managed_mode = false is recorded');
reset role;
select is((select managed_mode from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), false, 'a later upload overwrites managed_mode (leaving managed mode is visible)');
set local role service_role;
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a2',34,'2026-08-05',128000,64000,true)), 'inactive', 'REVOKED device -> inactive');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a3',34,'2026-08-05',128000,64000,true)), 'inactive', 'PENDING device -> inactive');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000ff',34,'2026-08-05',128000,64000,true)), 'inactive', 'unknown device -> inactive');
reset role;
select is((select count(*)::int from public.devices where id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3') and managed_mode is not null), 0, 'inactive devices were not written');
select is((select count(*)::int from public.devices where id = 'd0000000-0000-4000-8000-0000000000b1' and managed_mode is not null), 0, 'family B device untouched by uploads for A1');
set local role service_role;
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,64000,true)), 'recorded', 'A1 reports managed mode again');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000b1',31,'2026-01-05',64000,1000,false)), 'recorded', 'B1 reports a normal phone');
select is((select o_outcome from public.device_update_info('d0000000-0000-4000-8000-0000000000a1',34,'2026-08-05',128000,64000)), 'recorded', 'the 5-argument function still works');
reset role;
select is((select managed_mode from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), true, 'the 5-argument function never touches managed_mode');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select is((select managed_mode from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), true, 'parent A reads managed_mode of own device');
select is((select count(*)::int from public.devices where managed_mode is not null), 1, 'parent A sees managed_mode only on own reported device (B1 hidden by RLS)');
select is((select managed_mode from public.devices where id = 'd0000000-0000-4000-8000-0000000000b1'), null, 'parent A cannot read family B managed_mode');
select throws_ok($$update public.devices set managed_mode = false where id = 'd0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parent cannot write managed_mode');
select lives_ok($$update public.devices set device_name = 'Renamed' where id = 'd0000000-0000-4000-8000-0000000000a1'$$, 'parent can still rename the device');
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok($$select managed_mode from public.devices$$, '42501', null, 'anon cannot read managed_mode');
reset role;

select * from finish();
rollback;
