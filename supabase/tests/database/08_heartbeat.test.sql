begin;
select plan(44);

-- Fixture: family A (devices A1 ENROLLED, A2 REVOKED, A3 PENDING) and family B (B1 ENROLLED) ------------------
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

-- Privileges -------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role','public.device_heartbeat(uuid,text,text,int,boolean,text)','execute'), 'service_role can execute device_heartbeat');
select ok(has_function_privilege('service_role','public.device_mark_stale_offline(int)','execute'), 'service_role can execute device_mark_stale_offline');
select ok(not has_function_privilege('authenticated','public.device_heartbeat(uuid,text,text,int,boolean,text)','execute'), 'authenticated cannot execute device_heartbeat');
select ok(not has_function_privilege('authenticated','public.device_mark_stale_offline(int)','execute'), 'authenticated cannot execute device_mark_stale_offline');
select ok(not has_function_privilege('anon','public.device_heartbeat(uuid,text,text,int,boolean,text)','execute'), 'anon cannot execute device_heartbeat');
select ok(not has_function_privilege('anon','public.device_mark_stale_offline(int)','execute'), 'anon cannot execute device_mark_stale_offline');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('device_heartbeat','device_mark_stale_offline') and p.prosecdef and p.proconfig @> array['search_path=""']),
  2, 'both functions are SECURITY DEFINER with an empty search_path');

set local role service_role;

-- Input validation -------------------------------------------------------------------------------------
select throws_ok($$select * from public.device_heartbeat(null,'0.12.0','16',80,false,'WIFI')$$, '22023', null, 'NULL device id is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','','16',80,false,'WIFI')$$, '22023', null, 'empty app version is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','   ','16',80,false,'WIFI')$$, '22023', null, 'blank app version is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1',repeat('x',33),'16',80,false,'WIFI')$$, '22023', null, 'over-long app version is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0',null,80,false,'WIFI')$$, '22023', null, 'NULL android version is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',101,false,'WIFI')$$, '22023', null, 'battery above 100 is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',-1,false,'WIFI')$$, '22023', null, 'negative battery is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',null,false,'WIFI')$$, '22023', null, 'NULL battery is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',80,null,'WIFI')$$, '22023', null, 'NULL charging flag is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',80,false,'5G')$$, '22023', null, 'unknown network type is rejected');
select throws_ok($$select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',80,false,null)$$, '22023', null, 'NULL network type is rejected');

-- First beat: device becomes ONLINE, one DEVICE_ONLINE event ------------------------------------------------
select is((select o_outcome from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.0','16',80,false,'WIFI')), 'recorded', 'first beat is recorded');
reset role;
select is(
  (select row(app_version, android_version, battery_level, is_charging, network_type, device_status, last_seen_at = now())::text
     from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'),
  row('0.12.0','16',80,false,'WIFI','ONLINE',true)::text, 'device row carries the reported status and last_seen_at');
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'DEVICE_ONLINE'), 1, 'DEVICE_ONLINE written on the first beat');
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'BATTERY_LOW'), 0, 'no BATTERY_LOW at 80%');
select is((select metadata::text from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'DEVICE_ONLINE'), '{}', 'event metadata stays empty');

-- Second beat while ONLINE: values update, no new transition event ------------------------------------------
set local role service_role;
select is((select o_outcome from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',70,true,'CELLULAR')), 'recorded', 'second beat is recorded');
reset role;
select is(
  (select row(app_version, battery_level, is_charging, network_type)::text from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'),
  row('0.12.1',70,true,'CELLULAR')::text, 'values are overwritten by the latest beat');
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'DEVICE_ONLINE'), 1, 'no second DEVICE_ONLINE while already ONLINE');

-- OFFLINE -> ONLINE transition writes another DEVICE_ONLINE ---------------------------------------------------
update public.devices set device_status = 'OFFLINE' where id = 'd0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select o_outcome from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',70,true,'WIFI')), 'recorded', 'beat after OFFLINE is recorded');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'DEVICE_ONLINE'), 2, 'DEVICE_ONLINE written again on OFFLINE -> ONLINE');

-- BATTERY_LOW only on a new low state --------------------------------------------------------------------------
set local role service_role;
select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',10,false,'WIFI');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'BATTERY_LOW'), 1, 'BATTERY_LOW when level <= 15 and not charging');
set local role service_role;
select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',9,false,'WIFI');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'BATTERY_LOW'), 1, 'no repeat BATTERY_LOW while it stays low');
set local role service_role;
select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',9,true,'WIFI');
select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',12,false,'WIFI');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'BATTERY_LOW'), 2, 'BATTERY_LOW again after charging and dropping low again');
set local role service_role;
select * from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a1','0.12.1','16',15,false,'WIFI');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'BATTERY_LOW'), 2, 'still low at 15% -> no extra event');

-- Inactive devices: nothing is written ---------------------------------------------------------------------------
set local role service_role;
select is((select o_outcome from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a2','0.12.0','16',80,false,'WIFI')), 'inactive', 'REVOKED device is inactive');
select is((select o_outcome from public.device_heartbeat('d0000000-0000-4000-8000-0000000000a3','0.12.0','16',80,false,'WIFI')), 'inactive', 'PENDING device is inactive');
select is((select o_outcome from public.device_heartbeat('d0000000-0000-4000-8000-0000000000ff','0.12.0','16',80,false,'WIFI')), 'inactive', 'unknown device is inactive');
reset role;
select is(
  (select count(*)::int from public.devices where id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3')
     and (last_seen_at is not null or battery_level is not null or app_version is not null or device_status <> 'UNKNOWN')),
  0, 'inactive devices were not modified');
select is((select count(*)::int from public.device_events where device_id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3')), 0, 'inactive devices got no events');
select is((select row(last_seen_at is null, battery_level is null, device_status)::text from public.devices where id = 'd0000000-0000-4000-8000-0000000000b1'), row(true,true,'UNKNOWN')::text, 'family B device untouched by family A beats');

-- Offline sweep --------------------------------------------------------------------------------------------------
update public.devices set device_status = 'ONLINE', last_seen_at = now() - interval '1 hour'   where id = 'd0000000-0000-4000-8000-0000000000a1';
update public.devices set device_status = 'ONLINE', last_seen_at = now() - interval '1 minute' where id = 'd0000000-0000-4000-8000-0000000000b1';
update public.devices set device_status = 'ONLINE', last_seen_at = now() - interval '2 hours'  where id = 'd0000000-0000-4000-8000-0000000000a2';
set local role service_role;
select throws_ok($$select public.device_mark_stale_offline(60)$$, '22023', null, 'threshold below 5 minutes is rejected');
select throws_ok($$select public.device_mark_stale_offline(999999)$$, '22023', null, 'threshold above 24 hours is rejected');
select is(public.device_mark_stale_offline(2700), 1, 'sweep changes only the stale ENROLLED device');
select is(public.device_mark_stale_offline(2700), 0, 'sweep is idempotent');
reset role;
select is(
  (select array_agg(d.device_status order by d.device_name)::text from public.devices d where d.id in ('d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000a2')),
  '{OFFLINE,ONLINE,ONLINE}', 'A1 OFFLINE; fresh B1 and non-enrolled A2 keep their status');
select is((select count(*)::int from public.device_events where event_type = 'DEVICE_OFFLINE' and device_id = 'd0000000-0000-4000-8000-0000000000a1'), 1, 'exactly one DEVICE_OFFLINE event for A1');

select * from finish();
rollback;
