begin;
select plan(35);

-- Fixture: parent A (devices A1, A2) and parent B (B1) -------------------------------------------------------------------
insert into auth.users (id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.test');
insert into public.families (id,parent_id,name) values
  ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A'),
  ('f0000000-0000-4000-8000-00000000000b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fam B');
insert into public.children (id,family_id,name) values
  ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A'),
  ('c0000000-0000-4000-8000-00000000000b','f0000000-0000-4000-8000-00000000000b','Kid B');
insert into public.devices (id,child_id,device_name,enrollment_status) values
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','Phone A1','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','Phone A2','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','Phone B1','ENROLLED');

select ok(not has_function_privilege('anon','public.notify_parent(uuid,text,jsonb)','execute'), 'anon cannot execute notify_parent');
select ok(not has_function_privilege('authenticated','public.notify_parent(uuid,text,jsonb)','execute'), 'authenticated cannot execute notify_parent');
select ok(not has_function_privilege('service_role','public.notify_parent(uuid,text,jsonb)','execute'), 'not even service_role can execute notify_parent');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('notify_parent','device_events_notify','audit_logs_notify')), 'the producer functions are SECURITY DEFINER with an empty search_path');

insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','DEVICE_OFFLINE');
select results_eq($$select type, device_id, parent_id, metadata from public.notifications$$, $$values ('DEVICE_OFFLINE'::text, 'd0000000-0000-4000-8000-0000000000a1'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '{}'::jsonb)$$, 'an offline event notifies the owner of the device');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','DEVICE_OFFLINE');
select is((select count(*)::int from public.notifications where true), 1, 'a second offline event inside the window is dropped');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a2','DEVICE_OFFLINE');
select is((select count(*)::int from public.notifications where type = 'DEVICE_OFFLINE'), 2, 'another device gets its own notification');
select is((select count(*)::int from public.notifications where parent_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'the other parent got nothing');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','DEVICE_ONLINE'), ('d0000000-0000-4000-8000-0000000000a1','APP_INSTALLED'), ('d0000000-0000-4000-8000-0000000000a1','RULE_UPDATED');
select is((select count(*)::int from public.notifications where true), 2, 'online, app-installed and unknown events create no notification');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','BATTERY_LOW');
select is((select count(*)::int from public.notifications where type = 'BATTERY_LOW'), 1, 'battery low notifies');
insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-0000000000a1','BLOCKED_APP_ATTEMPT','{"package_name":"com.secret.app","occurred_at":"2026-10-01T09:00:00.000Z"}');
select results_eq($$select metadata from public.notifications where type = 'BLOCKED_APP_ATTEMPT'$$, $$values ('{}'::jsonb)$$, 'a blocked-app notification carries no package name');
insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-0000000000a1','PERMISSION_STATE_CHANGED','{"permission":"camera","from":"NOT_REQUESTED","to":"DENIED"}');
select is((select count(*)::int from public.notifications where type = 'PERMISSION_REVOKED'), 0, 'a permission that was never granted is not a revocation');
insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-0000000000a1','PERMISSION_STATE_CHANGED','{"permission":"camera","from":"DENIED","to":"GRANTED"}');
select is((select count(*)::int from public.notifications where type = 'PERMISSION_REVOKED'), 0, 'granting a permission is not a revocation');
insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-0000000000a1','PERMISSION_STATE_CHANGED','{"permission":"precise_location","from":"GRANTED","to":"REVOKED"}');
select results_eq($$select metadata from public.notifications where type = 'PERMISSION_REVOKED'$$, $$values ('{"permission":"precise_location"}'::jsonb)$$, 'a revoked permission is named by its key only');
insert into public.device_events (device_id,event_type,metadata) values ('d0000000-0000-4000-8000-0000000000a2','PERMISSION_STATE_CHANGED','{"permission":"<script>","from":"GRANTED","to":"DENIED"}');
select results_eq($$select metadata from public.notifications where type = 'PERMISSION_REVOKED' and device_id = 'd0000000-0000-4000-8000-0000000000a2'$$, $$values ('{}'::jsonb)$$, 'an odd permission key is dropped, the notification is kept');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','GEOFENCE_ENTER'), ('d0000000-0000-4000-8000-0000000000a1','GEOFENCE_ENTER'), ('d0000000-0000-4000-8000-0000000000a1','GEOFENCE_EXIT');
select is((select count(*)::int from public.notifications where type = 'GEOFENCE_ENTER'), 2, 'geofence events are never deduplicated');
select is((select count(*)::int from public.notifications where type = 'GEOFENCE_EXIT'), 1, 'geofence exit notifies');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','LIMIT_REACHED'), ('d0000000-0000-4000-8000-0000000000a1','LIMIT_REACHED');
select is((select count(*)::int from public.notifications where type = 'LIMIT_REACHED'), 1, 'limit reached is deduplicated inside its window');

delete from public.notifications where type = 'BATTERY_LOW';
insert into public.notifications (parent_id,device_id,type,created_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','BATTERY_LOW',now() - interval '7 hours');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','BATTERY_LOW');
select is((select count(*)::int from public.notifications where type = 'BATTERY_LOW' and device_id = 'd0000000-0000-4000-8000-0000000000a1'), 2, 'a battery notification older than six hours does not suppress a new one');

insert into public.notification_preferences (parent_id,type,enabled) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BLOCKED_APP_ATTEMPT',false), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','EMERGENCY',false);
delete from public.notifications where type = 'BLOCKED_APP_ATTEMPT';
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000a1','BLOCKED_APP_ATTEMPT');
select is((select count(*)::int from public.notifications where type = 'BLOCKED_APP_ATTEMPT'), 0, 'a type the parent switched off creates nothing');
insert into public.device_events (device_id,event_type) values ('d0000000-0000-4000-8000-0000000000b1','BATTERY_LOW');
select is((select count(*)::int from public.notifications where parent_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1, 'another parent''s preferences do not affect this parent');
select ok(('d0000000-0000-4000-8000-0000000000a1'::uuid is not null) and (select public.notify_parent('d0000000-0000-4000-8000-0000000000a1','EMERGENCY','{}'::jsonb)) is not null, 'an always-on type ignores a stored "off"');
select is((select count(*)::int from public.notifications where type = 'EMERGENCY'), 1, 'the emergency notification exists');
select throws_ok($$select public.notify_parent('d0000000-0000-4000-8000-0000000000a1','LOGIN','{}'::jsonb)$$, '22023', null, 'an unknown type is rejected');
select is((select public.notify_parent('d0000000-0000-4000-8000-0000000000ff','BATTERY_LOW','{}'::jsonb)), null, 'an unknown device notifies nobody');

insert into public.audit_logs (parent_id,device_id,action,metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a2','DEVICE_ENROLLED','{}');
select is((select count(*)::int from public.notifications where type = 'DEVICE_ENROLLED' and device_id = 'd0000000-0000-4000-8000-0000000000a2'), 1, 'enrollment notifies');
insert into public.audit_logs (parent_id,device_id,action,metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a2','DEVICE_REMOVED','{"reason":"revoked"}');
select is((select count(*)::int from public.notifications where type = 'SECURITY_EVENT'), 0, 'a removal the parent made is not a security event');
insert into public.audit_logs (parent_id,device_id,action,metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a2','DEVICE_REMOVED','{"reason":"credential_reuse"}');
select results_eq($$select metadata from public.notifications where type = 'SECURITY_EVENT'$$, $$values ('{"reason":"credential_reuse"}'::jsonb)$$, 'a reused credential is a security event with the reason only');
insert into public.audit_logs (parent_id,device_id,action,metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'LOGIN','{}'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','LOGIN','{}'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','RULE_CHANGED','{"fields":["app_rules"]}'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','APP_BLOCKED','{"fields":["blocked"]}');
select is((select count(*)::int from public.notifications where type in ('DEVICE_ENROLLED','SECURITY_EVENT')), 2, 'sign-ins and the parent''s own rule changes create no notification');

do $do$ begin for i in 1..505 loop perform public.notify_parent('d0000000-0000-4000-8000-0000000000b1','DEVICE_ENROLLED','{}'::jsonb); end loop; end $do$;
select is((select count(*)::int from public.notifications where parent_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 500, 'a parent keeps at most 500 notifications');
select ok((select count(distinct id) from public.notifications where parent_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 500, 'the rows that are kept are distinct');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select throws_ok($$select public.parent_set_notification_preference('EMERGENCY', false)$$, '22023', null, 'the preference RPC refuses to switch emergency off');
select throws_ok($$select public.parent_set_notification_preference('SECURITY_EVENT', false)$$, '22023', null, 'the preference RPC refuses to switch security events off');
select is((select public.parent_set_notification_preference('EMERGENCY', true)), 'unchanged', 'switching an always-on type on is a no-op');
select is((select public.parent_set_notification_preference('GEOFENCE_ENTER', false)), 'updated', 'other types can still be switched off');
reset role;

select * from finish();
rollback;
