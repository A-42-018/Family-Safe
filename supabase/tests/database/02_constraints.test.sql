begin;
select plan(31);

-- fixtures ----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test', '{"full_name":"Parent A","avatar_url":"https://x.test/a.png"}'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test', '{"avatar_url":"javascript:alert(1)"}');
insert into public.families (id, parent_id, name) values ('f0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Fam A');
insert into public.children (id, family_id, name) values ('c0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','Kid A');
insert into public.devices (id, child_id, device_name) values ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Phone A');
insert into public.devices (id, child_id, device_name) values ('d0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','Phone B');

-- auth triggers -----------------------------------------------------------
select is((select full_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'Parent A', 'profile auto-created from auth.users');
select is((select avatar_url from public.profiles where id = '22222222-2222-4222-8222-222222222222'), null, 'non-https avatar from metadata is dropped');
update auth.users set email = 'a2@example.test' where id = '11111111-1111-4111-8111-111111111111';
select is((select email from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'a2@example.test', 'email change syncs to profile');
select throws_ok($$insert into auth.users (id, email) values (gen_random_uuid(), 'a2@example.test')$$, '23505', null, 'duplicate email rejected');

-- device defaults + auto rows ---------------------------------------------
select is((select count(*)::int from public.device_rules where device_id = 'd0000000-0000-4000-8000-000000000001'), 1, 'device_rules row auto-created');
select is((select count(*)::int from public.device_permissions where device_id = 'd0000000-0000-4000-8000-000000000001'), 1, 'device_permissions row auto-created');
select is((select location_enabled or geofence_enabled or location_history_enabled or bedtime_enabled or school_mode_enabled
             from public.device_rules where device_id = 'd0000000-0000-4000-8000-000000000001'), false, 'all monitoring OFF by default');
select is((select camera_status from public.device_permissions where device_id = 'd0000000-0000-4000-8000-000000000001'), 'NOT_REQUESTED', 'permissions default NOT_REQUESTED');

-- enum / range CHECKs -----------------------------------------------------
select throws_ok($$update public.devices set device_status = 'HACKED' where id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'device_status enum');
select throws_ok($$update public.devices set enrollment_status = 'x' where id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'enrollment_status enum');
select throws_ok($$update public.devices set battery_level = 101 where id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'battery_level range');
select throws_ok($$update public.device_permissions set camera_status = 'MAYBE' where device_id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'permission status enum');
select throws_ok($$update public.device_rules set daily_screen_limit_minutes = 1441 where device_id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'screen limit range');
select throws_ok($$update public.device_rules set bedtime_enabled = true where device_id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'bedtime requires start/end');
select throws_ok($$update public.device_rules set location_history_enabled = true where device_id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'history requires location_enabled');
select throws_ok($$update public.device_rules set geofence_enabled = true where device_id = 'd0000000-0000-4000-8000-000000000001'$$, '23514', null, 'geofencing requires location_enabled');
select throws_ok($$insert into public.app_rules (device_id, package_name, app_name) values ('d0000000-0000-4000-8000-000000000001','notapackage','X')$$, '23514', null, 'package_name format (single segment)');
select throws_ok($$insert into public.app_rules (device_id, package_name, app_name) values ('d0000000-0000-4000-8000-000000000001','com.x; drop table','X')$$, '23514', null, 'package_name format (injection chars)');
insert into public.app_rules (device_id, package_name, app_name) values ('d0000000-0000-4000-8000-000000000001','com.example.app','App');
select throws_ok($$insert into public.app_rules (device_id, package_name, app_name) values ('d0000000-0000-4000-8000-000000000001','com.example.app','Dup')$$, '23505', null, 'app_rules unique (device, package)');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days) values ('d0000000-0000-4000-8000-000000000001','s','NOPE','08:00','09:00','{1}')$$, '23514', null, 'schedule type enum');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days) values ('d0000000-0000-4000-8000-000000000001','s','CUSTOM','08:00','09:00','{0,8}')$$, '23514', null, 'schedule days range');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days) values ('d0000000-0000-4000-8000-000000000001','s','CUSTOM','08:00','09:00','{1,1}')$$, '23514', null, 'schedule days duplicates');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days) values ('d0000000-0000-4000-8000-000000000001','s','CUSTOM','08:00','08:00','{1}')$$, '23514', null, 'schedule start <> end');
select lives_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days) values ('d0000000-0000-4000-8000-000000000001','Night','BEDTIME','21:00','07:00','{1,2,3,4,5,6,7}')$$, 'overnight schedule allowed');
select throws_ok($$insert into public.location_points (device_id,latitude,longitude,accuracy_meters,recorded_at) values ('d0000000-0000-4000-8000-000000000001',91,0,5,now())$$, '23514', null, 'latitude range');
select throws_ok($$insert into public.location_points (device_id,latitude,longitude,accuracy_meters,recorded_at) values ('d0000000-0000-4000-8000-000000000001',0,181,5,now())$$, '23514', null, 'longitude range');
select throws_ok($$insert into public.geofences (device_id,name,latitude,longitude,radius_meters) values ('d0000000-0000-4000-8000-000000000001','g',0,0,10)$$, '23514', null, 'geofence radius min');
select throws_ok($$insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-000000000001','bad type','{}')$$, '23514', null, 'event_type format');
select throws_ok($$insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-000000000001','RULE_UPDATED','[1]')$$, '23514', null, 'event metadata must be object');
select throws_ok($$insert into public.pairing_tokens (child_id,created_by,token_hash,expires_at) values ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111', decode('00','hex'), now()+interval '5 minutes')$$, '23514', null, 'pairing token hash must be 32 bytes');
select throws_ok($$insert into public.pairing_tokens (child_id,created_by,token_hash,expires_at) values ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111', decode(repeat('ab',32),'hex'), now()+interval '2 hours')$$, '23514', null, 'pairing token TTL capped at 1h');

select * from finish();
rollback;
