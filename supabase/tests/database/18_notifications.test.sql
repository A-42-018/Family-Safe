begin;
select plan(60);

-- Fixture: parents A and B, one enrolled device each --------------------------------------------------------------------
insert into auth.users (id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.test');
insert into public.families (id,parent_id,name) values
  ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A'),
  ('f0000000-0000-4000-8000-00000000000b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fam B');
insert into public.children (id,family_id,name) values
  ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A'),
  ('c0000000-0000-4000-8000-00000000000b','f0000000-0000-4000-8000-00000000000b','Kid B');
insert into public.devices (id,child_id,device_name,enrollment_status) values
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','Phone A1','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','Phone B1','ENROLLED');
insert into public.notifications (id,parent_id,device_id,type,metadata,created_at,read_at) values
  ('e0000000-0000-4000-8000-000000000011','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','DEVICE_OFFLINE','{}',now() - interval '3 hours',null),
  ('e0000000-0000-4000-8000-000000000012','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','BATTERY_LOW','{"level":15}',now() - interval '2 hours',now() - interval '1 hour'),
  ('e0000000-0000-4000-8000-000000000013','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'EMERGENCY','{}',now() - interval '1 hour',null),
  ('e0000000-0000-4000-8000-000000000021','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','d0000000-0000-4000-8000-0000000000b1','DEVICE_OFFLINE','{}',now() - interval '1 hour',null);

select has_table('public','notifications','notifications exists');
select has_table('public','notification_preferences','notification_preferences exists');
select is((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass), true, 'RLS is on for notifications');
select is((select relrowsecurity from pg_class where oid = 'public.notification_preferences'::regclass), true, 'RLS is on for notification_preferences');
select ok(not has_table_privilege('anon','public.notifications','select'), 'anon cannot read notifications');
select ok(has_table_privilege('authenticated','public.notifications','select'), 'authenticated can read notifications');
select ok(not has_table_privilege('authenticated','public.notifications','insert'), 'authenticated cannot insert notifications');
select ok(not has_table_privilege('authenticated','public.notifications','update'), 'authenticated cannot update notifications');
select ok(not has_table_privilege('authenticated','public.notifications','delete'), 'authenticated cannot delete notifications');
select ok(has_table_privilege('authenticated','public.notification_preferences','select'), 'authenticated can read preferences');
select ok(not has_table_privilege('authenticated','public.notification_preferences','insert'), 'authenticated cannot write preferences directly');
select ok(not has_function_privilege('anon','public.parent_mark_notifications_read(uuid[])','execute'), 'anon cannot mark notifications read');
select ok(has_function_privilege('authenticated','public.parent_mark_notifications_read(uuid[])','execute'), 'authenticated can mark notifications read');
select ok(not has_function_privilege('anon','public.parent_set_notification_preference(text,boolean)','execute'), 'anon cannot set preferences');
select ok(has_function_privilege('authenticated','public.parent_set_notification_preference(text,boolean)','execute'), 'authenticated can set preferences');
select ok(not has_function_privilege('authenticated','public.notifications_purge_expired()','execute'), 'authenticated cannot purge');
select ok(has_function_privilege('service_role','public.notifications_purge_expired()','execute'), 'service_role can purge');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('parent_mark_notifications_read','parent_set_notification_preference','notifications_purge_expired')), 'all three functions are SECURITY DEFINER with an empty search_path');

select throws_ok($$insert into public.notifications (parent_id,type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','LOGIN')$$, '23514', null, 'an unknown type is rejected');
select throws_ok($$insert into public.notifications (parent_id,type,metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW','[]')$$, '23514', null, 'metadata must be an object');
select throws_ok($$insert into public.notifications (parent_id,type,metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW',jsonb_build_object('x',repeat('a',2100)))$$, '23514', null, 'metadata above 2048 bytes is rejected');
select throws_ok($$insert into public.notifications (parent_id,type,created_at,read_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW',now(),now() - interval '1 hour')$$, '23514', null, 'read_at cannot precede created_at');
select throws_ok($$insert into public.notification_preferences (parent_id,type,enabled) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','LOGIN',false)$$, '23514', null, 'an unknown preference type is rejected');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select is((select count(*)::int from public.notifications), 3, 'parent A sees exactly their own three notifications');
select is((select count(*)::int from public.notifications where id = 'e0000000-0000-4000-8000-000000000021'), 0, 'parent A cannot see parent B''s notification by id');
select throws_ok($$insert into public.notifications (parent_id,type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW')$$, '42501', null, 'parent cannot insert a notification');
select throws_ok($$update public.notifications set read_at = now() where id = 'e0000000-0000-4000-8000-000000000011'$$, '42501', null, 'parent cannot update a notification directly');
select throws_ok($$delete from public.notifications where id = 'e0000000-0000-4000-8000-000000000011'$$, '42501', null, 'parent cannot delete a notification');
select throws_ok($$insert into public.notification_preferences (parent_id,type,enabled) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW',false)$$, '42501', null, 'parent cannot write preferences directly');
select is((select public.parent_mark_notifications_read(array['e0000000-0000-4000-8000-000000000011'::uuid])), 1, 'one unread notification is marked read');
select is((select public.parent_mark_notifications_read(array['e0000000-0000-4000-8000-000000000011'::uuid])), 0, 'marking it again changes nothing');
select is((select public.parent_mark_notifications_read(array['e0000000-0000-4000-8000-000000000012'::uuid])), 0, 'an already read notification is not touched');
select is((select public.parent_mark_notifications_read(array['e0000000-0000-4000-8000-000000000021'::uuid])), 0, 'a foreign id is ignored');
select throws_ok($$select public.parent_mark_notifications_read((select array_agg(gen_random_uuid()) from generate_series(1,201)))$$, '22023', null, 'more than 200 ids are rejected');
select is((select public.parent_mark_notifications_read()), 1, 'no ids marks every remaining unread notification');
select is((select count(*)::int from public.notifications where read_at is null), 0, 'parent A has nothing unread left');
select is((select public.parent_mark_notifications_read()), 0, 'a second mark-all changes nothing');
select is((select public.parent_set_notification_preference('EMERGENCY', false)), 'updated', 'switching a type off is stored');
select is((select public.parent_set_notification_preference('EMERGENCY', false)), 'unchanged', 'the same value again is unchanged');
select is((select public.parent_set_notification_preference('BATTERY_LOW', true)), 'unchanged', 'a never-stored type is already enabled');
select is((select count(*)::int from public.notification_preferences), 1, 'only the changed type is stored');
select is((select enabled from public.notification_preferences where type = 'EMERGENCY'), false, 'the stored value is readable by its owner');
select is((select public.parent_set_notification_preference('EMERGENCY', true)), 'updated', 'switching back on is stored');
select throws_ok($$select public.parent_set_notification_preference('LOGIN', true)$$, '22023', null, 'an unknown type is rejected by the RPC');
select throws_ok($$select public.parent_set_notification_preference(null, true)$$, '22023', null, 'a NULL type is rejected');
select throws_ok($$select public.parent_set_notification_preference('EMERGENCY', null)$$, '22023', null, 'a NULL flag is rejected');
select throws_ok($$select public.notifications_purge_expired()$$, '42501', null, 'parent cannot purge');
reset role;
select is((select read_at is null from public.notifications where id = 'e0000000-0000-4000-8000-000000000021'), true, 'parent B''s notification stayed unread');
select is((select count(*)::int from public.notifications where read_at < created_at), 0, 'read_at never precedes created_at');

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select is((select count(*)::int from public.notifications), 1, 'parent B sees only their own notification');
select is((select count(*)::int from public.notification_preferences), 0, 'parent B sees none of parent A''s preferences');
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$select public.parent_mark_notifications_read()$$, '42501', null, 'a principal without a sub cannot mark notifications');
select throws_ok($$select public.parent_set_notification_preference('EMERGENCY', true)$$, '42501', null, 'a principal without a sub cannot set preferences');
reset role;
set local role anon;
select throws_ok($$select * from public.notifications$$, '42501', null, 'anon cannot read notifications');
select throws_ok($$select public.parent_mark_notifications_read()$$, '42501', null, 'anon cannot call the RPC');
reset role;

insert into public.notifications (id,parent_id,type,created_at) values
  ('e0000000-0000-4000-8000-000000000031','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW',now() - interval '95 days'),
  ('e0000000-0000-4000-8000-000000000032','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','BATTERY_LOW',now() - interval '89 days');
set local role service_role;
select is((select public.notifications_purge_expired()), 1, 'the purge deletes exactly the rows older than 90 days');
reset role;
select is((select count(*)::int from public.notifications where id = 'e0000000-0000-4000-8000-000000000032'), 1, 'a row inside the window survives the purge');

delete from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.notifications where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 0, 'removing a device removes its notifications');
select is((select count(*)::int from public.notifications where id = 'e0000000-0000-4000-8000-000000000013'), 1, 'a notification without a device is kept');
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*)::int from public.notifications where parent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') + (select count(*)::int from public.notification_preferences where parent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0, 'deleting the parent removes their notifications and preferences');

select * from finish();
rollback;
