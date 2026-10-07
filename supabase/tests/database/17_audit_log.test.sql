begin;
select plan(34);

-- Fixture: family A (devices A1, A2) and family B (B1); audit rows with fixed ages (now() is fixed inside the transaction)
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
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','Phone A1','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','Phone A2','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','Phone B1','ENROLLED');
insert into public.audit_logs (id,parent_id,device_id,action,metadata,ip_address,created_at) values
  ('e0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'LOGIN','{}','203.0.113.5',now() - interval '1 hour'),
  ('e0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','DEVICE_ENROLLED','{}',null,now() - interval '2 hours'),
  ('e0000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','RULE_CHANGED','{"fields":["app_rules"]}',null,now() - interval '3 hours'),
  ('e0000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a2','RULE_CHANGED','{"fields":["timezone"]}',null,now() - interval '4 hours'),
  ('e0000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a1','APP_BLOCKED','{"fields":["blocked"]}',null,now() - interval '5 hours'),
  ('e0000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'LOGIN','{}','203.0.113.6',now() - interval '40 days'),
  ('e0000000-0000-4000-8000-0000000000b1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,'LOGIN','{}',null,now() - interval '1 hour');

select ok(not has_function_privilege('anon','public.parent_list_audit_logs(text,uuid,timestamptz,timestamptz,timestamptz,uuid,int)','execute'), 'anon cannot execute the list function');
select ok(has_function_privilege('authenticated','public.parent_list_audit_logs(text,uuid,timestamptz,timestamptz,timestamptz,uuid,int)','execute'), 'authenticated can execute the list function');
select ok(not has_function_privilege('anon','public.audit_purge_expired()','execute'), 'anon cannot purge');
select ok(not has_function_privilege('authenticated','public.audit_purge_expired()','execute'), 'authenticated cannot purge');
select ok(has_function_privilege('service_role','public.audit_purge_expired()','execute'), 'service_role can purge');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('parent_list_audit_logs','audit_purge_expired')), 'both functions are SECURITY DEFINER with an empty search_path');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select is((select count(*)::int from public.parent_list_audit_logs()), 6, 'parent A lists exactly their own six rows');
select is((select count(*)::int from public.parent_list_audit_logs(p_limit => null)), 6, 'a NULL limit means the default');
select results_eq($$select o_action from public.parent_list_audit_logs(p_limit => 3)$$, $$values ('LOGIN'::text),('DEVICE_ENROLLED'::text),('RULE_CHANGED'::text)$$, 'newest first');
select results_eq($$select o_id from public.parent_list_audit_logs(p_limit => 2)$$, $$values ('e0000000-0000-4000-8000-000000000001'::uuid),('e0000000-0000-4000-8000-000000000002'::uuid)$$, 'page one has the two newest rows');
select results_eq($$select o_id from public.parent_list_audit_logs(p_before_at => (select o_created_at from public.parent_list_audit_logs(p_limit => 2) offset 1 limit 1), p_before_id => (select o_id from public.parent_list_audit_logs(p_limit => 2) offset 1 limit 1), p_limit => 2)$$, $$values ('e0000000-0000-4000-8000-000000000003'::uuid),('e0000000-0000-4000-8000-000000000004'::uuid)$$, 'page two continues after the cursor with no overlap');
select is((select count(*)::int from public.parent_list_audit_logs(p_action => 'RULE_CHANGED')), 2, 'action filter');
select is((select count(*)::int from public.parent_list_audit_logs(p_device_id => 'd0000000-0000-4000-8000-0000000000a1')), 3, 'device filter');
select is((select count(*)::int from public.parent_list_audit_logs(p_device_id => 'd0000000-0000-4000-8000-0000000000b1')), 0, 'a foreign device filter returns nothing');
select is((select count(*)::int from public.parent_list_audit_logs(p_from => now() - interval '6 hours')), 5, 'from filter excludes the 40-day-old row');
select results_eq($$select o_action from public.parent_list_audit_logs(p_to => now() - interval '4 hours 30 minutes')$$, $$values ('APP_BLOCKED'::text),('LOGIN'::text)$$, 'to filter is exclusive and keeps newest first');
select is((select count(*)::int from public.parent_list_audit_logs(p_action => 'RULE_CHANGED', p_device_id => 'd0000000-0000-4000-8000-0000000000a2', p_from => now() - interval '5 hours', p_to => now() - interval '3 hours 30 minutes')), 1, 'filters combine');
select results_eq($$select o_device_name, o_metadata, o_ip from public.parent_list_audit_logs(p_action => 'APP_BLOCKED')$$, $$values ('Phone A1'::text, '{"fields":["blocked"]}'::jsonb, null::text)$$, 'the row carries the device name and the metadata as stored');
select is((select o_ip from public.parent_list_audit_logs(p_limit => 1)), '203.0.113.5', 'the parent sees the address of their own sign-in as text');
select throws_ok($$select * from public.parent_list_audit_logs(p_action => 'login')$$, '22023', null, 'a malformed action filter is rejected');
select throws_ok($$select * from public.parent_list_audit_logs(p_limit => 0)$$, '22023', null, 'limit 0 is rejected');
select throws_ok($$select * from public.parent_list_audit_logs(p_limit => 101)$$, '22023', null, 'limit 101 is rejected');
select throws_ok($$select * from public.parent_list_audit_logs(p_from => now(), p_to => now() - interval '1 hour')$$, '22023', null, 'an empty time range is rejected');
select throws_ok($$select * from public.parent_list_audit_logs(p_before_at => now())$$, '22023', null, 'half a cursor is rejected');
select throws_ok($$select * from public.parent_list_audit_logs(p_before_id => 'e0000000-0000-4000-8000-000000000001')$$, '22023', null, 'the other half of a cursor is rejected too');
select throws_ok($$select * from public.audit_purge_expired()$$, '42501', null, 'parent cannot purge');
reset role;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select is((select count(*)::int from public.parent_list_audit_logs()), 1, 'parent B lists only their own row');
select is((select count(*)::int from public.parent_list_audit_logs(p_device_id => 'd0000000-0000-4000-8000-0000000000a1')), 0, 'parent B cannot reach A1 through the filter');
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$select * from public.parent_list_audit_logs()$$, '42501', null, 'a principal without a sub is refused');
reset role;
set local role anon;
select throws_ok($$select * from public.parent_list_audit_logs()$$, '42501', null, 'anon cannot list audit rows');
reset role;

insert into public.audit_logs (id,parent_id,device_id,action,metadata,created_at) values
  ('e0000000-0000-4000-8000-000000000007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'LOGIN','{}',now() - interval '200 days'),
  ('e0000000-0000-4000-8000-0000000000b2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,'LOGIN','{}',now() - interval '181 days'),
  ('e0000000-0000-4000-8000-0000000000b3','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,'LOGIN','{}',now() - interval '179 days');
set local role service_role;
select is((select public.audit_purge_expired()), 2, 'the purge deletes exactly the rows older than 180 days');
reset role;
select is((select count(*)::int from public.audit_logs where created_at < now() - interval '180 days'), 0, 'no expired row is left');
select is((select count(*)::int from public.audit_logs), 8, 'rows inside the window (including the 179-day one) survive');
set local role service_role;
select is((select public.audit_purge_expired()), 0, 'a second purge finds nothing');
reset role;

select * from finish();
rollback;
