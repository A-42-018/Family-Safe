begin;
select plan(95);

-- Fixture: family A (A1 ENROLLED service-path, A2 REVOKED, A3 PENDING, A4 ENROLLED parent-path) and family B (B1 ENROLLED)
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
  ('d0000000-0000-4000-8000-0000000000a4','c0000000-0000-4000-8000-00000000000a','A4','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');
select set_config('request.jwt.claim.sub', '', true);

-- structure and privileges ------------------------------------------------------------------------------------------
select has_column('public','device_rules','config_version','device_rules.config_version exists');
select has_column('public','device_rules','daily_limit_overrides','device_rules.daily_limit_overrides exists');
select results_eq($$select config_version, daily_limit_overrides from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (1, '{}'::jsonb)$$, 'new rules start at version 1 with no overrides');
select is((select count(*)::int from public.device_commands where command_type='SYNC_CONFIG' and device_id::text like 'd0000000-%'), 0, 'creating devices queues no SYNC_CONFIG');
select ok(has_function_privilege('authenticated','public.parent_set_screen_time_rules(uuid,int,jsonb)','execute'), 'authenticated can execute parent_set_screen_time_rules');
select ok(not has_function_privilege('anon','public.parent_set_screen_time_rules(uuid,int,jsonb)','execute'), 'anon cannot execute parent_set_screen_time_rules');
select ok(has_function_privilege('service_role','public.device_get_config(uuid)','execute'), 'service_role can execute device_get_config');
select ok(not has_function_privilege('authenticated','public.device_get_config(uuid)','execute'), 'authenticated cannot execute device_get_config');
select ok(not has_function_privilege('anon','public.device_get_config(uuid)','execute'), 'anon cannot execute device_get_config');
select ok(not has_function_privilege('authenticated','public.device_rules_config_changed()','execute'), 'authenticated cannot execute the sync trigger function');
select ok(not has_function_privilege('authenticated','public.device_rules_bump_config_version()','execute'), 'authenticated cannot execute the version trigger function');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('parent_set_screen_time_rules','device_get_config','device_rules_config_changed')), 'the SECURITY DEFINER functions have an empty search_path');
select ok(not has_column_privilege('authenticated','public.device_rules','daily_limit_overrides','update'), 'parent has no direct UPDATE on daily_limit_overrides');
select ok(not has_column_privilege('authenticated','public.device_rules','config_version','update'), 'parent has no direct UPDATE on config_version');
select ok(has_column_privilege('authenticated','public.device_rules','config_version','select'), 'parent can read config_version');
select ok(has_column_privilege('authenticated','public.device_rules','daily_screen_limit_minutes','update'), 'the existing column grants are unchanged');

-- is_valid_day_limits ------------------------------------------------------------------------------------------------
select is(public.is_valid_day_limits('{}'::jsonb), true, 'empty overrides are valid');
select is(public.is_valid_day_limits('{"1":0,"7":1440}'::jsonb), true, 'bounds 0 and 1440 are valid');
select is(public.is_valid_day_limits('{"1":0,"2":1,"3":2,"4":3,"5":4,"6":5,"7":6}'::jsonb), true, 'all seven weekdays are valid');
select is(public.is_valid_day_limits('{"0":5}'::jsonb), false, 'weekday 0 is invalid');
select is(public.is_valid_day_limits('{"8":5}'::jsonb), false, 'weekday 8 is invalid');
select is(public.is_valid_day_limits('{"mon":5}'::jsonb), false, 'weekday names are invalid');
select is(public.is_valid_day_limits('{"1":1441}'::jsonb), false, '1441 minutes is invalid');
select is(public.is_valid_day_limits('{"1":-1}'::jsonb), false, 'negative minutes are invalid');
select is(public.is_valid_day_limits('{"1":1.5}'::jsonb), false, 'fractional minutes are invalid');
select is(public.is_valid_day_limits('{"1":"60"}'::jsonb), false, 'string minutes are invalid');
select is(public.is_valid_day_limits('{"1":null}'::jsonb), false, 'null minutes are invalid');
select is(public.is_valid_day_limits('[]'::jsonb), false, 'an array is invalid');
select is(public.is_valid_day_limits('null'::jsonb), false, 'a JSON null is invalid');
select is(public.is_valid_day_limits(null::jsonb), false, 'SQL NULL is invalid (never raises)');
select throws_ok($$update public.device_rules set daily_limit_overrides='{"9":1}' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'the column CHECK rejects bad overrides');
update public.device_rules set config_version=99 where device_id='d0000000-0000-4000-8000-0000000000b1';
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000b1'), 1, 'a caller cannot set config_version (the trigger keeps the stored value)');

-- service path: every write is versioned, deduped and queued; no session = no audit row ---------------------------------
update public.device_rules set daily_screen_limit_minutes=120, daily_limit_overrides='{"6":240,"7":0}', bedtime_enabled=true, bedtime_start='21:00', bedtime_end='07:00', school_mode_enabled=true where device_id='d0000000-0000-4000-8000-0000000000a1';
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'), 2, 'one multi-column update bumps the version once');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG' and status='PENDING'), 1, 'a change queues one PENDING SYNC_CONFIG');
select results_eq($$select payload, expires_at = now() + interval '24 hours' from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG'$$, $$values ('{}'::jsonb, true)$$, 'the command carries no rule values and expires in 24 h');
select is((select count(*)::int from public.audit_logs), 0, 'a change without a parent session writes no audit row');
update public.device_rules set daily_screen_limit_minutes=120, bedtime_enabled=true where device_id='d0000000-0000-4000-8000-0000000000a1';
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'), 2, 'a no-op update does not bump the version');
update public.device_rules set daily_screen_limit_minutes=90 where device_id='d0000000-0000-4000-8000-0000000000a1';
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'), 3, 'a real change bumps the version by one');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG'), 1, 'a second change while one is PENDING queues no duplicate');
update public.device_rules set location_enabled=true where device_id='d0000000-0000-4000-8000-0000000000a1';
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'), 3, 'a location toggle is not part of the config and does not bump the version');
update public.device_rules set daily_screen_limit_minutes=120 where device_id='d0000000-0000-4000-8000-0000000000a1';
update public.device_rules set school_mode_enabled=true where device_id='d0000000-0000-4000-8000-0000000000a2';
update public.device_rules set daily_screen_limit_minutes=30 where device_id='d0000000-0000-4000-8000-0000000000a2';
select results_eq($$select config_version, (select count(*)::int from public.device_commands c where c.device_id=r.device_id) from public.device_rules r where r.device_id='d0000000-0000-4000-8000-0000000000a2'$$, $$values (3, 0)$$, 'a REVOKED device is versioned but never gets a command');
update public.device_rules set daily_screen_limit_minutes=30 where device_id='d0000000-0000-4000-8000-0000000000a3';
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a3'), 0, 'a PENDING (not yet enrolled) device gets no command');

-- device_get_config ------------------------------------------------------------------------------------------------------
set local role service_role;
select results_eq($$select o_outcome, o_config_version, o_daily_limit_minutes, o_daily_limit_overrides, o_bedtime_enabled, o_bedtime_start, o_bedtime_end, o_school_mode_enabled from public.device_get_config('d0000000-0000-4000-8000-0000000000a1')$$, $$values ('ok'::text, 4, 120, '{"6":240,"7":0}'::jsonb, true, '21:00'::text, '07:00'::text, true)$$, 'device_get_config returns the stored config with HH24:MI times');
reset role;
update public.device_rules set bedtime_enabled=false where device_id='d0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select results_eq($$select o_outcome, o_config_version, o_bedtime_enabled, o_bedtime_start, o_bedtime_end from public.device_get_config('d0000000-0000-4000-8000-0000000000a1')$$, $$values ('ok'::text, 5, false, null::text, null::text)$$, 'bedtime times are hidden while bedtime is disabled');
select results_eq($$select o_outcome, o_config_version, o_daily_limit_minutes, o_daily_limit_overrides, o_bedtime_enabled, o_school_mode_enabled from public.device_get_config('d0000000-0000-4000-8000-0000000000b1')$$, $$values ('ok'::text, 1, null::int, '{}'::jsonb, false, false)$$, 'another device reads only its own defaults');
select results_eq($$select o_outcome, o_config_version, o_daily_limit_minutes, o_daily_limit_overrides, o_bedtime_enabled, o_bedtime_start, o_bedtime_end, o_school_mode_enabled from public.device_get_config('d0000000-0000-4000-8000-0000000000a2')$$, $$values ('inactive'::text, 0, null::int, '{}'::jsonb, false, null::text, null::text, false)$$, 'REVOKED device -> inactive, no rule data');
select results_eq($$select o_outcome, o_config_version from public.device_get_config('d0000000-0000-4000-8000-0000000000a3')$$, $$values ('inactive'::text, 0)$$, 'PENDING device -> inactive');
select results_eq($$select o_outcome, o_config_version from public.device_get_config('d0000000-0000-4000-8000-00000000ffff')$$, $$values ('inactive'::text, 0)$$, 'unknown device -> inactive');
select throws_ok($$select * from public.device_get_config(null)$$, '22023', null, 'a NULL device id is rejected');
select results_eq($$select o_app_rules from public.device_get_config('d0000000-0000-4000-8000-0000000000a1')$$, $$values ('[]'::jsonb)$$, 'a device without app rules gets an empty o_app_rules (Phase 18a column)');
reset role;
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'), 5, 'reading the config never changes the version');

-- parent path: parent_set_screen_time_rules on A4 ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 90, '{"6":240}')$$, $$values ('updated'::text, 2)$$, 'first real change -> updated, version 2');
reset role;
select results_eq($$select daily_screen_limit_minutes, daily_limit_overrides, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values (90, '{"6":240}'::jsonb, 2)$$, 'the values are stored');
select results_eq($$select count(*)::int, count(*) filter (where status='PENDING')::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG'$$, $$values (1, 1)$$, 'one PENDING SYNC_CONFIG was queued');
select results_eq($$select action, parent_id, metadata -> 'fields', ip_address from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values ('RULE_CHANGED'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '["daily_screen_limit_minutes","daily_limit_overrides"]'::jsonb, null::inet)$$, 'RULE_CHANGED audited for the parent with field names');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata::text ~ '[0-9]'), 0, 'the audit row holds no values or numbers');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 90, '{"6":240}')$$, $$values ('unchanged'::text, 2)$$, 'identical input -> unchanged, same version');
reset role;
select results_eq($$select (select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4'), (select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4')$$, $$values (1, 1)$$, 'unchanged -> no new command, no new audit row');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, '{"6":240}')$$, $$values ('updated'::text, 3)$$, 'second change -> version 3');
reset role;
select results_eq($$select (select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4'), (select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4')$$, $$values (1, 2)$$, 'a PENDING command dedupes; every change is audited');
update public.device_commands set status='DELIVERED' where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG' and status='PENDING';
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, '{"6":240,"7":0}')$$, $$values ('updated'::text, 4)$$, 'change after the command was delivered -> version 4');
reset role;
select results_eq($$select count(*)::int, count(*) filter (where status='PENDING')::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG'$$, $$values (2, 1)$$, 'a DELIVERED command does not dedupe: a fresh PENDING one is queued');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', null, '{}')$$, $$values ('updated'::text, 5)$$, 'clearing the limit and overrides is a change (null = no limit)');
reset role;
select results_eq($$select daily_screen_limit_minutes, daily_limit_overrides from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values (null::int, '{}'::jsonb)$$, 'null limit and empty overrides are stored');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata -> 'fields' = '["daily_screen_limit_minutes"]'::jsonb), 1, 'audit lists only the changed field (limit)');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata -> 'fields' = '["daily_limit_overrides"]'::jsonb), 1, 'audit lists only the changed field (overrides)');

-- validation: nothing is written on invalid input -------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 1441, '{}')$$, '22023', null, 'limit 1441 is rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', -1, '{}')$$, '22023', null, 'negative limit is rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, '{"9":10}')$$, '22023', null, 'weekday 9 is rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, '{"1":1441}')$$, '22023', null, 'override 1441 is rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, '{"1":1.5}')$$, '22023', null, 'fractional override is rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, '[]')$$, '22023', null, 'array overrides are rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, 'null')$$, '22023', null, 'JSON null overrides are rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 60, null)$$, '22023', null, 'SQL NULL overrides are rejected');
select throws_ok($$select * from public.parent_set_screen_time_rules(null, 60, '{}')$$, '22023', null, 'a NULL device id is rejected');
reset role;
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'), 5, 'rejected calls did not change the version');

-- ownership and device state ------------------------------------------------------------------------------------------------------
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000b1', 10, '{}')$$, $$values ('not_found'::text, 0)$$, 'family B device -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-00000000ffff', 10, '{}')$$, $$values ('not_found'::text, 0)$$, 'unknown device -> the same not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a2', 10, '{}')$$, $$values ('inactive'::text, 0)$$, 'own REVOKED device -> inactive (read-only)');
select results_eq($$select o_outcome, o_config_version from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a3', 10, '{}')$$, $$values ('inactive'::text, 0)$$, 'own PENDING device -> inactive');
reset role;
select results_eq($$select config_version, daily_screen_limit_minutes, (select count(*)::int from public.device_commands c where c.device_id=r.device_id), (select count(*)::int from public.audit_logs a where a.device_id=r.device_id) from public.device_rules r where r.device_id='d0000000-0000-4000-8000-0000000000b1'$$, $$values (1, null::int, 0, 0)$$, 'family B rules, commands and audit are untouched');
select results_eq($$select daily_screen_limit_minutes from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a2'$$, $$values (30)$$, 'the REVOKED device keeps its rules');

-- principals ---------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 10, '{}')$$, '42501', null, 'authenticated without a sub claim is refused');
reset role;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-0000000000a4', true);
set local role authenticated;
select results_eq($$select o_outcome from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 10, '{}')$$, $$values ('not_found'::text)$$, 'a principal whose sub is a device id owns nothing');
reset role;
set local role anon;
select throws_ok($$select * from public.parent_set_screen_time_rules('d0000000-0000-4000-8000-0000000000a4', 10, '{}')$$, '42501', null, 'anon cannot call the parent RPC');
reset role;
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'), 5, 'refused principals changed nothing');

-- direct column grants stay versioned (PostgREST path) ------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select lives_ok($$update public.device_rules set bedtime_enabled=true, bedtime_start='21:00', bedtime_end='07:00' where device_id='d0000000-0000-4000-8000-0000000000a4'$$, 'parent can still update bedtime directly');
select throws_ok($$update public.device_rules set daily_limit_overrides='{"1":5}' where device_id='d0000000-0000-4000-8000-0000000000a4'$$, '42501', null, 'parent cannot write overrides directly');
select throws_ok($$update public.device_rules set config_version=99 where device_id='d0000000-0000-4000-8000-0000000000a4'$$, '42501', null, 'parent cannot write config_version');
reset role;
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'), 6, 'a direct bedtime change bumps the version once');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata -> 'fields' = '["bedtime_enabled","bedtime_start","bedtime_end"]'::jsonb), 1, 'the direct change is audited as RULE_CHANGED with its field names');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG' and status='PENDING'), 1, 'the direct change keeps one PENDING SYNC_CONFIG');
set local role authenticated;
update public.device_rules set location_enabled=true where device_id='d0000000-0000-4000-8000-0000000000a4';
update public.device_rules set bedtime_enabled=true where device_id='d0000000-0000-4000-8000-0000000000a4';
reset role;
select results_eq($$select config_version, (select count(*)::int from public.audit_logs a where a.device_id=r.device_id) from public.device_rules r where r.device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values (6, 5)$$, 'a location toggle and a no-op update: no bump, no audit row');

-- parent visibility -------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select results_eq($$select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values (6)$$, 'parent A reads the version of its device');
select is((select count(*)::int from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000b1'), 0, 'parent A cannot read family B rules');
reset role;

select * from finish();
rollback;
