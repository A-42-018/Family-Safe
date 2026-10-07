begin;
select plan(30);

-- Fixture: A1 ENROLLED with a limit, A2 ENROLLED without any limit, A3 REVOKED, A4 PENDING -------------------------------
insert into auth.users (id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test');
insert into public.families (id,parent_id,name) values ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A');
insert into public.children (id,family_id,name) values ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A');
insert into public.devices (id,child_id,device_name,enrollment_status) values
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','A1','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','A2','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a3','c0000000-0000-4000-8000-00000000000a','A3','REVOKED'),
  ('d0000000-0000-4000-8000-0000000000a4','c0000000-0000-4000-8000-00000000000a','A4','PENDING');
update public.device_rules set daily_screen_limit_minutes = 60 where device_id = 'd0000000-0000-4000-8000-0000000000a1';
update public.device_rules set daily_limit_overrides = '{"6":30}' where device_id = 'd0000000-0000-4000-8000-0000000000a3';
update public.device_rules set daily_limit_overrides = '{"6":30}' where device_id = 'd0000000-0000-4000-8000-0000000000a4';
delete from public.device_commands;

select ok(not has_function_privilege('anon','public.device_record_limit_reached(uuid,date,timestamptz)','execute'), 'anon cannot execute the function');
select ok(not has_function_privilege('authenticated','public.device_record_limit_reached(uuid,date,timestamptz)','execute'), 'authenticated cannot execute the function');
select ok(has_function_privilege('service_role','public.device_record_limit_reached(uuid,date,timestamptz)','execute'), 'service_role can execute the function');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.device_record_limit_reached(uuid,date,timestamptz)'::regprocedure), 'SECURITY DEFINER with an empty search_path');

set local role service_role;
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date,now() - interval '2 minutes')), 'recorded', 'a report for a device with a limit is recorded');
reset role;
select results_eq($$select event_type, metadata ->> 'day', (metadata - 'day' - 'occurred_at') from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1'$$, $$values ('LIMIT_REACHED'::text, to_char((now() at time zone 'UTC')::date,'YYYY-MM-DD'), '{}'::jsonb)$$, 'the event holds the day and the time and nothing else');
select is((select (select count(*) from jsonb_object_keys(metadata))::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 2, 'exactly two metadata keys');
set local role service_role;
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date,now() - interval '1 minute')), 'recorded', 'a second report for the same day answers the same');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'LIMIT_REACHED'), 1, 'but is not stored again');
set local role service_role;
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date - 1,now() - interval '3 hours')), 'recorded', 'another day is a new report');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a1' and event_type = 'LIMIT_REACHED'), 2, 'one event per day');
select is((select count(*)::int from public.notifications where device_id = 'd0000000-0000-4000-8000-0000000000a1' and type = 'LIMIT_REACHED'), 1, 'the notification producer fired once (its one-hour window merges the two)');
select is((select metadata from public.notifications where device_id = 'd0000000-0000-4000-8000-0000000000a1' and type = 'LIMIT_REACHED'), '{}'::jsonb, 'the notification carries no data');

set local role service_role;
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a2',(now() at time zone 'UTC')::date,now())), 'recorded', 'a device with no limit gets the same answer');
reset role;
select is((select count(*)::int from public.device_events where device_id = 'd0000000-0000-4000-8000-0000000000a2'), 0, 'but nothing is stored for it');
set local role service_role;
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a3',(now() at time zone 'UTC')::date,now())), 'inactive', 'a REVOKED device is inactive');
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a4',(now() at time zone 'UTC')::date,now())), 'inactive', 'a PENDING device is inactive');
select is((select o_outcome from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000ff',(now() at time zone 'UTC')::date,now())), 'inactive', 'an unknown device is inactive');
select throws_ok($$select * from public.device_record_limit_reached(null,(now() at time zone 'UTC')::date,now())$$, '22023', null, 'a NULL device is rejected');
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',null,now())$$, '22023', null, 'a NULL day is rejected');
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date,null)$$, '22023', null, 'a NULL time is rejected');
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date - 2,now())$$, '22023', null, 'a day two days back is rejected');
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date + 2,now())$$, '22023', null, 'a day two days ahead is rejected');
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date,now() - interval '25 hours')$$, '22023', null, 'a time 25 hours back is rejected');
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date,now() + interval '10 minutes')$$, '22023', null, 'a time 10 minutes ahead is rejected');
select lives_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date + 1,now() + interval '4 minutes')$$, 'the edges of both windows are accepted');
reset role;
select is((select device_status || ':' || coalesce(last_seen_at::text,'-') from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), 'UNKNOWN:-', 'a report never changes device_status or last_seen_at');
select is((select count(*)::int from public.audit_logs), 0, 'a report writes no audit row');
select is((select count(*)::int from public.device_commands), 0, 'a report queues no command');
set local role anon;
select throws_ok($$select * from public.device_record_limit_reached('d0000000-0000-4000-8000-0000000000a1',(now() at time zone 'UTC')::date,now())$$, '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
