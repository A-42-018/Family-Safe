begin;
select plan(25);

-- The suite runs after seed.sql: start from an empty family tree so the counts below are exact (everything cascades from here).
delete from auth.users;

-- Fixture: parent A, A1 ENROLLED + ONLINE but silent for two hours, A2 ENROLLED + ONLINE and fresh ---------------------
insert into auth.users (id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test');
insert into public.families (id,parent_id,name) values ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A');
insert into public.children (id,family_id,name) values ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A');
insert into public.devices (id,child_id,device_name,enrollment_status,device_status,last_seen_at) values
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','A1','ENROLLED','ONLINE',now() - interval '2 hours'),
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','A2','ENROLLED','ONLINE',now() - interval '1 minute');

-- one row older than the window and one inside it, per table ---------------------------------------------------------------
insert into public.device_events (device_id,event_type,created_at) values
  ('d0000000-0000-4000-8000-0000000000a2','RULE_UPDATED',now() - interval '91 days'), ('d0000000-0000-4000-8000-0000000000a2','RULE_UPDATED',now() - interval '89 days');
insert into public.app_usage_daily (device_id,package_name,usage_date) values
  ('d0000000-0000-4000-8000-0000000000a2','com.old.app',(now() at time zone 'UTC')::date - 91), ('d0000000-0000-4000-8000-0000000000a2','com.new.app',(now() at time zone 'UTC')::date - 89);
insert into public.device_usage_daily (device_id,usage_date) values
  ('d0000000-0000-4000-8000-0000000000a2',(now() at time zone 'UTC')::date - 91), ('d0000000-0000-4000-8000-0000000000a2',(now() at time zone 'UTC')::date - 89);
insert into public.location_points (device_id,latitude,longitude,accuracy_meters,recorded_at) values
  ('d0000000-0000-4000-8000-0000000000a2',1,1,5,now() - interval '91 days'), ('d0000000-0000-4000-8000-0000000000a2',1,1,5,now() - interval '89 days');
insert into public.device_commands (device_id,command_type,status,expires_at,created_at) values
  ('d0000000-0000-4000-8000-0000000000a2','SYNC_CONFIG','EXPIRED',now() - interval '31 days' + interval '1 hour',now() - interval '31 days'),
  ('d0000000-0000-4000-8000-0000000000a2','SYNC_CONFIG','PENDING',now() + interval '1 hour',now());
insert into public.device_credentials (device_id,refresh_token_hash,issued_at,expires_at,rotated_at) values
  ('d0000000-0000-4000-8000-0000000000a2',decode(repeat('aa',32),'hex'),now() - interval '60 days',now() - interval '31 days',now() - interval '45 days');
insert into public.device_credentials (device_id,refresh_token_hash,issued_at,expires_at) values
  ('d0000000-0000-4000-8000-0000000000a2',decode(repeat('bb',32),'hex'),now() - interval '1 day',now() + interval '10 days');
insert into public.pairing_tokens (child_id,created_by,token_hash,expires_at,created_at) values
  ('c0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',decode(repeat('cc',32),'hex'),now() - interval '8 days',now() - interval '8 days 30 minutes'),
  ('c0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',decode(repeat('dd',32),'hex'),now() + interval '10 minutes',now());
insert into public.audit_logs (parent_id,action,created_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','LOGIN',now() - interval '181 days'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','LOGIN',now() - interval '179 days');
insert into public.notifications (parent_id,device_id,type,created_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a2','BATTERY_LOW',now() - interval '91 days'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a2','BATTERY_LOW',now() - interval '89 days');

select ok(not has_function_privilege('anon','public.retention_run()','execute'), 'anon cannot run retention');
select ok(not has_function_privilege('authenticated','public.retention_run()','execute'), 'authenticated cannot run retention');
select ok(has_function_privilege('service_role','public.retention_run()','execute'), 'service_role can run retention');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.retention_run()'::regprocedure), 'SECURITY DEFINER with an empty search_path');

set local role service_role;
select is((select public.retention_run()), '{"devices_marked_offline":1,"device_commands_expired":0,"audit_logs":1,"notifications":1,"device_events":1,"app_usage_daily":1,"device_usage_daily":1,"location_points":1,"device_commands":1,"device_credentials":1,"pairing_tokens":1}'::jsonb, 'one run removes exactly the old row of every kind and marks the silent device');
reset role;
select is((select device_status from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), 'OFFLINE', 'the silent device is OFFLINE');
select is((select device_status from public.devices where id = 'd0000000-0000-4000-8000-0000000000a2'), 'ONLINE', 'the fresh device stays ONLINE');
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'DEVICE_OFFLINE'), 1, 'the sweep wrote a DEVICE_OFFLINE event');
select is((select count(*)::int from public.notifications where device_id = 'd0000000-0000-4000-8000-0000000000a1' and type = 'DEVICE_OFFLINE'), 1, 'and the producer turned it into a notification');
select is((select count(*)::int from public.device_events where event_type = 'RULE_UPDATED'), 1, 'only the 89-day-old event is left');
select is((select package_name from public.app_usage_daily), 'com.new.app', 'only the 89-day-old app usage is left');
select is((select count(*)::int from public.device_usage_daily), 1, 'only the 89-day-old device usage is left');
select is((select count(*)::int from public.location_points), 1, 'only the 89-day-old location point is left');
select is((select status from public.device_commands), 'PENDING', 'only the fresh command is left');
select is((select count(*)::int from public.device_credentials where expires_at > now()), 1, 'the valid credential is kept');
select is((select count(*)::int from public.device_credentials), 1, 'the long-expired credential is gone');
select is((select count(*)::int from public.pairing_tokens where expires_at > now()), 1, 'the live pairing code is kept');
select is((select count(*)::int from public.pairing_tokens), 1, 'the long-expired pairing code is gone');
select is((select count(*)::int from public.audit_logs where created_at < now() - interval '180 days'), 0, 'no audit row older than 180 days is left');
select is((select count(*)::int from public.audit_logs), 1, 'the 179-day-old audit row survives');
select is((select count(*)::int from public.notifications where created_at < now() - interval '90 days'), 0, 'no notification older than 90 days is left');
select is((select count(*)::int from public.notifications where type = 'BATTERY_LOW'), 1, 'the 89-day-old notification survives');

set local role service_role;
select is((select public.retention_run()), '{"devices_marked_offline":0,"device_commands_expired":0,"audit_logs":0,"notifications":0,"device_events":0,"app_usage_daily":0,"device_usage_daily":0,"location_points":0,"device_commands":0,"device_credentials":0,"pairing_tokens":0}'::jsonb, 'a second run changes nothing');
reset role;
set local role authenticated;
select throws_ok($$select public.retention_run()$$, '42501', null, 'a signed-in parent cannot run it');
reset role;
set local role anon;
select throws_ok($$select public.retention_run()$$, '42501', null, 'anon cannot run it');
reset role;

select * from finish();
rollback;
