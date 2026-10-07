begin;
select plan(136);

-- Fixture: family A (A1 ENROLLED service path + RPC cap, A2 REVOKED, A3 PENDING (service cap), A4 ENROLLED parent RPC path,
-- A5 ENROLLED parent direct-write path) and family B (B1 ENROLLED: read ordering + the daily event cap)
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
  ('d0000000-0000-4000-8000-0000000000a5','c0000000-0000-4000-8000-00000000000a','A5','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');
-- Reported inventories (the parent RPC only creates rules for reported packages)
insert into public.device_apps (device_id,package_name,label) values
  ('d0000000-0000-4000-8000-0000000000a1','com.example.youtube','YouTube'),
  ('d0000000-0000-4000-8000-0000000000a1','com.example.game','Game'),
  ('d0000000-0000-4000-8000-0000000000a4','com.example.youtube','YouTube'),
  ('d0000000-0000-4000-8000-0000000000a4','com.example.game','Game'),
  ('d0000000-0000-4000-8000-0000000000a4','com.example.chat','Chat'),
  ('d0000000-0000-4000-8000-0000000000b1','com.example.youtube','YouTube');
select set_config('request.jwt.claim.sub', '', true);

-- helpers for event payloads (session-local)
create function pg_temp.ts(m int) returns text language sql as $f$
  select to_char((now() - make_interval(mins => m)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$f$;
create function pg_temp.evx(t text, p text, tstxt text) returns jsonb language sql as $f$
  select jsonb_build_object('type', t, 'package_name', p, 'occurred_at', tstxt)
$f$;
create function pg_temp.ev(p text, m int) returns jsonb language sql as $f$
  select pg_temp.evx('BLOCKED_APP_ATTEMPT', p, pg_temp.ts(m))
$f$;

-- structure and privileges ------------------------------------------------------------------------------------------
select has_column('public','device_rules','app_rules_revision','device_rules.app_rules_revision exists');
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values (0, 1)$$, 'new rules start at revision 0 and version 1');
select ok(has_function_privilege('authenticated','public.parent_set_app_rule(uuid,text,boolean,int)','execute'), 'authenticated can execute parent_set_app_rule');
select ok(not has_function_privilege('anon','public.parent_set_app_rule(uuid,text,boolean,int)','execute'), 'anon cannot execute parent_set_app_rule');
select ok(has_function_privilege('service_role','public.device_record_app_attempts(uuid,jsonb)','execute'), 'service_role can execute device_record_app_attempts');
select ok(not has_function_privilege('authenticated','public.device_record_app_attempts(uuid,jsonb)','execute'), 'authenticated cannot execute device_record_app_attempts');
select ok(not has_function_privilege('anon','public.device_record_app_attempts(uuid,jsonb)','execute'), 'anon cannot execute device_record_app_attempts');
select ok(not has_function_privilege('authenticated','public.app_rules_enforce_cap()','execute'), 'authenticated cannot execute the cap trigger function');
select ok(not has_function_privilege('authenticated','public.app_rules_touch_revision()','execute'), 'authenticated cannot execute the revision trigger function');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('parent_set_app_rule','device_record_app_attempts','device_get_config','app_rules_enforce_cap','app_rules_touch_revision','device_rules_config_changed')), 'the SECURITY DEFINER functions have an empty search_path');
select ok(not has_column_privilege('authenticated','public.device_rules','app_rules_revision','update'), 'parent has no direct UPDATE on app_rules_revision');
select ok(has_column_privilege('authenticated','public.device_rules','app_rules_revision','select'), 'parent can read app_rules_revision');
select throws_ok($$insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000a1','app.familysafe.child','Self',true)$$, '23514', null, 'the child app itself cannot be given a rule');

-- service path: every effective change is versioned, deduped and queued; no-effect rows are not -------------------------
insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000a1','com.example.youtube','YouTube',true);
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (1, 2)$$, 'a blocking rule moves the revision and the config version');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG' and status='PENDING'), 1, 'the change queued one PENDING SYNC_CONFIG');
select is((select count(*)::int from public.audit_logs), 0, 'a change without a parent session writes no audit row');
insert into public.app_rules (device_id,package_name,app_name) values ('d0000000-0000-4000-8000-0000000000a1','com.example.game','Game');
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (1, 2)$$, 'a row that restricts nothing does not bump anything');
update public.app_rules set app_name='Game 2' where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.example.game';
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (1, 2)$$, 'a rename does not bump anything');
update public.app_rules set daily_limit_minutes=30 where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.example.game';
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (2, 3)$$, 'adding a limit bumps the revision and the version');
update public.app_rules set blocked=true where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.example.game';
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (3, 4)$$, 'blocking bumps again');
update public.app_rules set daily_limit_minutes=45 where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.example.game';
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (4, 5)$$, 'a stored limit that changes while blocked still bumps (it is part of the payload)');
delete from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.example.game';
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (5, 6)$$, 'deleting an effective rule bumps');
insert into public.app_rules (device_id,package_name,app_name,daily_limit_minutes) values ('d0000000-0000-4000-8000-0000000000a1','com.example.chat','Chat',0);
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (6, 7)$$, 'a limit of 0 minutes is an effective rule');
insert into public.app_rules (device_id,package_name,app_name) values ('d0000000-0000-4000-8000-0000000000a1','com.example.noop','Noop');
delete from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a1' and package_name='com.example.noop';
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (6, 7)$$, 'inserting and deleting a no-effect row leaves revision and version alone');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG'), 1, 'a PENDING command dedupes the whole burst');
insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000a2','com.example.youtube','YouTube',true);
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a2'$$, $$values (1, 2)$$, 'a revoked device still versions its rules');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a2'), 0, 'but no command is queued for a device that is not ENROLLED');

-- cap: at most 200 rules per device on every insert path -----------------------------------------------------------------
select lives_ok($$insert into public.app_rules (device_id,package_name,app_name,blocked) select 'd0000000-0000-4000-8000-0000000000a3','com.cap.app'||g,'App '||g,true from generate_series(1,200) g$$, 'two hundred rules are accepted');
select throws_ok($$insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000a3','com.cap.extra','Extra',true)$$, '22023', null, 'the 201st rule is refused');
select is((select count(*)::int from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a3'), 200, 'exactly 200 rules are stored');
select lives_ok($$insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000b1','com.cap.other','Other',true)$$, 'the cap is per device');

-- parent path: parent_set_app_rule on A4 --------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.youtube',true,null)$$, $$values ('updated'::text, 2)$$, 'a new block -> updated, version 2');
reset role;
select results_eq($$select package_name, app_name, blocked, daily_limit_minutes from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values ('com.example.youtube'::text, 'YouTube'::text, true, null::int)$$, 'the rule is stored with the reported label');
select results_eq($$select action, parent_id, metadata -> 'fields', ip_address from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and action='RULE_CHANGED'$$, $$values ('RULE_CHANGED'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '["app_rules"]'::jsonb, null::inet)$$, 'RULE_CHANGED is audited with the field name only');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata::text ~* 'example|youtube'), 0, 'the audit row holds no package name');
select results_eq($$select action, metadata -> 'fields' from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and action='APP_BLOCKED'$$, $$values ('APP_BLOCKED'::text, '["blocked"]'::jsonb)$$, 'the block is audited as APP_BLOCKED with the field name only');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG' and status='PENDING'), 1, 'one PENDING SYNC_CONFIG was queued');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.youtube',true,null)$$, $$values ('unchanged'::text, 2)$$, 'identical input -> unchanged, same version');
reset role;
select results_eq($$select (select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4'), (select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4')$$, $$values (1, 2)$$, 'unchanged -> no new command, no new audit row (RULE_CHANGED + APP_BLOCKED from the first block)');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.youtube',false,30)$$, $$values ('updated'::text, 3)$$, 'unblock with a limit -> updated, version 3');
reset role;
select results_eq($$select blocked, daily_limit_minutes from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.youtube'$$, $$values (false, 30)$$, 'the limit is stored');
select results_eq($$select (select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4'), (select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4')$$, $$values (1, 4)$$, 'a PENDING command dedupes; every change is audited (RULE_CHANGED + APP_UNBLOCKED added)');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and action='APP_UNBLOCKED'), 1, 'the unblock is audited as APP_UNBLOCKED');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.youtube',false,null)$$, $$values ('cleared'::text, 4)$$, 'no block and no limit -> the rule is deleted (cleared, version 4)');
reset role;
select is((select count(*)::int from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4'), 0, 'a cleared rule leaves no row behind');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and action in ('APP_BLOCKED','APP_UNBLOCKED')), 2, 'clearing an already unblocked rule adds no APP_BLOCKED / APP_UNBLOCKED row');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.youtube',false,null)$$, $$values ('unchanged'::text, 4)$$, 'clearing a rule that does not exist -> unchanged');
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',false,0)$$, $$values ('updated'::text, 5)$$, 'a limit of 0 minutes is a rule (version 5)');
reset role;
select results_eq($$select blocked, daily_limit_minutes from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.game'$$, $$values (false, 0)$$, 'the 0-minute limit is stored');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',true,20)$$, $$values ('updated'::text, 6)$$, 'block + limit -> updated (version 6)');
reset role;
select results_eq($$select blocked, daily_limit_minutes from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.game'$$, $$values (true, 20)$$, 'blocked and the stored limit are kept together');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.notreported',true,null)$$, $$values ('unknown_app'::text, 0)$$, 'a new rule for an app the device never reported -> unknown_app');
reset role;
select is((select count(*)::int from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.notreported'), 0, 'unknown_app writes nothing');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.chat',true,null)$$, $$values ('updated'::text, 7)$$, 'chat blocked (version 7)');
reset role;
delete from public.device_apps where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.chat';
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.chat',false,null)$$, $$values ('cleared'::text, 8)$$, 'an existing rule can be cleared after the app left the inventory');
reset role;

-- validation: nothing is written on invalid input ---------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','notapackage',true,null)$$, '22023', null, 'a name without a dot is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com..bad',true,null)$$, '22023', null, 'an empty segment is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.1bad.app',true,null)$$, '22023', null, 'a segment that starts with a digit is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.'||repeat('a',300),true,null)$$, '22023', null, 'a name longer than 255 characters is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4',null,true,null)$$, '22023', null, 'a NULL package name is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','app.familysafe.child',true,null)$$, '22023', null, 'the child app itself cannot be restricted');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',null,null)$$, '22023', null, 'a NULL blocked flag is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',false,1441)$$, '22023', null, 'a limit of 1441 is rejected');
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',false,-1)$$, '22023', null, 'a negative limit is rejected');
select throws_ok($$select * from public.parent_set_app_rule(null,'com.example.game',true,null)$$, '22023', null, 'a NULL device id is rejected');
reset role;
select results_eq($$select config_version, (select count(*)::int from public.app_rules a where a.device_id=r.device_id) from public.device_rules r where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values (8, 1)$$, 'rejected calls changed nothing');

-- ownership, device state and the session ----------------------------------------------------------------------------------
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000b1','com.example.youtube',true,null)$$, $$values ('not_found'::text, 0)$$, 'family B device -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-00000000ffff','com.example.youtube',true,null)$$, $$values ('not_found'::text, 0)$$, 'unknown device -> the same not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a2','com.example.youtube',false,null)$$, $$values ('inactive'::text, 0)$$, 'own REVOKED device -> inactive');
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a3','com.example.youtube',true,null)$$, $$values ('inactive'::text, 0)$$, 'own PENDING device -> inactive');
reset role;
select results_eq($$select (select count(*)::int from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000b1'), (select count(*)::int from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a2' and package_name='com.example.youtube')$$, $$values (1, 1)$$, 'family B and the revoked device were not touched');
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',true,null)$$, '42501', null, 'authenticated without a sub claim is refused');
reset role;
set local role anon;
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',true,null)$$, '42501', null, 'anon cannot call the parent RPC');
reset role;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a4','com.example.game',false,null)$$, $$values ('not_found'::text, 0)$$, 'parent B cannot clear parent A rules');
reset role;
select is((select blocked from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.game'), true, 'parent A rule survived');

-- RPC cap: A1 filled to exactly 200 rules --------------------------------------------------------------------------------------
select lives_ok($$insert into public.app_rules (device_id,package_name,app_name,blocked) select 'd0000000-0000-4000-8000-0000000000a1','com.fill.app'||g,'Fill '||g,true from generate_series(1,198) g$$, 'A1 is filled to 200 rules');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select throws_ok($$select * from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a1','com.example.game',true,null)$$, '22023', null, 'a new rule beyond 200 is refused by the RPC');
select results_eq($$select o_outcome from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a1','com.example.youtube',false,10)$$, $$values ('updated'::text)$$, 'an existing rule can still be changed at the cap');
select results_eq($$select o_outcome from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a1','com.fill.app1',false,null)$$, $$values ('cleared'::text)$$, 'clearing a rule frees a slot');
select results_eq($$select o_outcome from public.parent_set_app_rule('d0000000-0000-4000-8000-0000000000a1','com.example.game',true,null)$$, $$values ('updated'::text)$$, 'and the freed slot can be used');
reset role;

-- parent direct writes (PostgREST grants) are versioned too, on A5 ---------------------------------------------------------------
set local role authenticated;
select lives_ok($$insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000a5','com.example.direct','Direct',true)$$, 'a parent can still insert a rule directly');
reset role;
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a5'$$, $$values (1, 2)$$, 'the direct insert bumped revision and version');
select results_eq($$select action, metadata -> 'fields' from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a5'$$, $$values ('RULE_CHANGED'::text, '["app_rules"]'::jsonb)$$, 'and was audited with the field name only');
set local role authenticated;
update public.app_rules set blocked=false where device_id='d0000000-0000-4000-8000-0000000000a5' and package_name='com.example.direct';
reset role;
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a5'$$, $$values (2, 3)$$, 'a direct unblock bumps');
set local role authenticated;
delete from public.app_rules where device_id='d0000000-0000-4000-8000-0000000000a5' and package_name='com.example.direct';
reset role;
select results_eq($$select app_rules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a5'$$, $$values (2, 3)$$, 'deleting the now no-effect row does not bump');

-- device_get_config: o_app_rules ---------------------------------------------------------------------------------------------------
select results_eq($$select o_app_rules from public.device_get_config('d0000000-0000-4000-8000-0000000000a4')$$, $$values ('[{"package_name":"com.example.game","blocked":true,"daily_limit_minutes":20}]'::jsonb)$$, 'A4 gets exactly its effective rule');
select results_eq($$select o_app_rules from public.device_get_config('d0000000-0000-4000-8000-0000000000a5')$$, $$values ('[]'::jsonb)$$, 'a device with no effective rule gets an empty array');
insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000b1','com.zeta.app','Zeta',true);
insert into public.app_rules (device_id,package_name,app_name,daily_limit_minutes) values ('d0000000-0000-4000-8000-0000000000b1','com.alpha.app','Alpha',15);
insert into public.app_rules (device_id,package_name,app_name) values ('d0000000-0000-4000-8000-0000000000b1','com.mid.app','Mid');
select results_eq($$select o_app_rules from public.device_get_config('d0000000-0000-4000-8000-0000000000b1')$$, $$values ('[{"package_name":"com.alpha.app","blocked":false,"daily_limit_minutes":15},{"package_name":"com.cap.other","blocked":true,"daily_limit_minutes":null},{"package_name":"com.zeta.app","blocked":true,"daily_limit_minutes":null}]'::jsonb)$$, 'rules are ordered by package name and a no-effect row is not delivered');
select is((select o_app_rules::text !~ 'app_name|"(Alpha|Zeta|Mid)"' from public.device_get_config('d0000000-0000-4000-8000-0000000000b1')), true, 'labels are never sent to the device');
select results_eq($$select o_outcome, o_app_rules from public.device_get_config('d0000000-0000-4000-8000-0000000000a2')$$, $$values ('inactive'::text, '[]'::jsonb)$$, 'a REVOKED device gets no rules even though rows exist');
select results_eq($$select o_outcome, o_app_rules from public.device_get_config('d0000000-0000-4000-8000-0000000000a3')$$, $$values ('inactive'::text, '[]'::jsonb)$$, 'a PENDING device gets no rules');
select is((select jsonb_array_length(o_app_rules) from public.device_get_config('d0000000-0000-4000-8000-0000000000a1')), 200, 'a full device returns all 200 rules');
select is((select config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'), 8, 'reading the config never changes the version');

-- device_record_app_attempts ---------------------------------------------------------------------------------------------------------
insert into public.app_rules (device_id,package_name,app_name,daily_limit_minutes) values ('d0000000-0000-4000-8000-0000000000a4','com.example.limitonly','Limit only',5);
insert into public.app_rules (device_id,package_name,app_name,blocked) values ('d0000000-0000-4000-8000-0000000000a4','com.example.chat','Chat',true);
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game', 10)))$$, $$values ('recorded'::text, 1, 0)$$, 'an attempt on a blocked app is recorded');
select results_eq($$select event_type, metadata ->> 'package_name' from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a4' and event_type='BLOCKED_APP_ATTEMPT'$$, $$values ('BLOCKED_APP_ATTEMPT'::text, 'com.example.game'::text)$$, 'the event is stored');
select is((select array_agg(k order by k) from public.device_events e, jsonb_object_keys(e.metadata) k where e.device_id='d0000000-0000-4000-8000-0000000000a4' and e.event_type='BLOCKED_APP_ATTEMPT'), array['occurred_at','package_name']::text[], 'the metadata holds only the package name and the time');
select ok((select (metadata ->> 'occurred_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a4' and event_type='BLOCKED_APP_ATTEMPT'), 'the stored time is normalised to UTC with milliseconds');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game', 8)))$$, $$values ('recorded'::text, 0, 1)$$, 'a second attempt within 5 minutes is throttled');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game', 20)))$$, $$values ('recorded'::text, 1, 0)$$, 'an attempt 10 minutes earlier is recorded');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game', 20)))$$, $$values ('recorded'::text, 0, 1)$$, 'a retried upload of the same event is deduped');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.youtube', 30), pg_temp.ev('com.example.limitonly', 30), pg_temp.ev('com.example.unknown', 30)))$$, $$values ('recorded'::text, 0, 3)$$, 'unblocked, limit-only and unknown apps are ignored');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game', 40), pg_temp.ev('com.example.chat', 40), pg_temp.ev('com.example.chat', 41)))$$, $$values ('recorded'::text, 2, 1)$$, 'a mixed batch: two apps recorded, the second chat attempt throttled');
update public.app_rules set blocked=false where device_id='d0000000-0000-4000-8000-0000000000a4' and package_name='com.example.chat';
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.chat', 90)))$$, $$values ('recorded'::text, 0, 1)$$, 'an app the parent unblocked meanwhile is ignored');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a4' and event_type='BLOCKED_APP_ATTEMPT'), 4, 'four attempts were stored in total');
select lives_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(jsonb_build_object('type','BLOCKED_APP_ATTEMPT','package_name','com.example.unknown','occurred_at', to_char((now() - interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))$$, 'a time without a fraction is accepted');
select lives_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.unknown', -4)))$$, 'a time 4 minutes ahead (clock skew) is accepted');
select lives_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.unknown', 1380)))$$, 'a time 23 hours back is accepted');

-- validation: any violation raises 22023 and nothing is written ---------------------------------------------------------------------
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', null)$$, '22023', null, 'NULL events are rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', '[]'::jsonb)$$, '22023', null, 'an empty array is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', '{}'::jsonb)$$, '22023', null, 'an object instead of an array is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', (select jsonb_agg(pg_temp.ev('com.example.unknown', i)) from generate_series(1,21) i))$$, '22023', null, '21 events are rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.evx('OTHER_EVENT','com.example.game',pg_temp.ts(5))))$$, '22023', null, 'another event type is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game',5) || '{"x":1}'::jsonb))$$, '22023', null, 'an extra key is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game',5) - 'occurred_at'))$$, '22023', null, 'a missing key is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('not a package',5)))$$, '22023', null, 'a malformed package name is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.'||repeat('a',300),5)))$$, '22023', null, 'a package name over 255 characters is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.evx('BLOCKED_APP_ATTEMPT','com.example.game','2026-10-01 10:00:00')))$$, '22023', null, 'a time without T and Z is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.evx('BLOCKED_APP_ATTEMPT','com.example.game',replace(pg_temp.ts(5),'Z','+00:00'))))$$, '22023', null, 'a time zone offset instead of Z is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.evx('BLOCKED_APP_ATTEMPT','com.example.game','2026-13-45T00:00:00Z')))$$, '22023', null, 'an impossible date is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game',1500)))$$, '22023', null, 'a time older than 24 hours is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game',-10)))$$, '22023', null, 'a time more than 5 minutes ahead is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(jsonb_build_object('type','BLOCKED_APP_ATTEMPT','package_name',5,'occurred_at',pg_temp.ts(5))))$$, '22023', null, 'a non-string package name is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', '["x"]'::jsonb)$$, '22023', null, 'an entry that is not an object is rejected');
select throws_ok($$select * from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a4', jsonb_build_array(pg_temp.ev('com.example.game',50), pg_temp.ev('not a package',50)))$$, '22023', null, 'one bad entry rejects the whole batch');
select throws_ok($$select * from public.device_record_app_attempts(null, jsonb_build_array(pg_temp.ev('com.example.game',50)))$$, '22023', null, 'a NULL device id is rejected');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a4' and event_type='BLOCKED_APP_ATTEMPT'), 4, 'rejected batches wrote nothing');

-- inactive devices ---------------------------------------------------------------------------------------------------------------------
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a2', jsonb_build_array(pg_temp.ev('com.example.youtube', 10)))$$, $$values ('inactive'::text, 0, 0)$$, 'a REVOKED device -> inactive');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000a3', jsonb_build_array(pg_temp.ev('com.cap.app1', 10)))$$, $$values ('inactive'::text, 0, 0)$$, 'a PENDING device -> inactive');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-00000000ffff', jsonb_build_array(pg_temp.ev('com.example.youtube', 10)))$$, $$values ('inactive'::text, 0, 0)$$, 'an unknown device -> inactive');
select is((select count(*)::int from public.device_events where device_id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3') and event_type='BLOCKED_APP_ATTEMPT'), 0, 'inactive devices stored no event');

-- daily flood cap: 200 events per device per 24 h -----------------------------------------------------------------------------------------
select lives_ok($$do $do$ begin for g in 0..9 loop perform public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000b1', (select jsonb_agg(pg_temp.ev('com.zeta.app', 6*(g*20+i)+1)) from generate_series(0,19) i)); end loop; end $do$ $$, 'ten batches of twenty events run');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000b1' and event_type='BLOCKED_APP_ATTEMPT'), 200, 'exactly 200 events were stored');
select results_eq($$select o_outcome, o_recorded, o_ignored from public.device_record_app_attempts('d0000000-0000-4000-8000-0000000000b1', jsonb_build_array(pg_temp.ev('com.zeta.app', 1300)))$$, $$values ('recorded'::text, 0, 1)$$, 'the 201st event within 24 hours is ignored');

-- side effects --------------------------------------------------------------------------------------------------------------------------------
select results_eq($$select last_seen_at is null, device_status from public.devices where id='d0000000-0000-4000-8000-0000000000b1'$$, $$select last_seen_at is null, device_status from public.devices where id='d0000000-0000-4000-8000-0000000000a5'$$, 'attempts do not touch liveness columns');
select is((select count(*)::int from public.audit_logs where action not in ('RULE_CHANGED','APP_BLOCKED','APP_UNBLOCKED')), 0, 'attempts write no audit row');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000b1'), 1, 'attempts queue no command (only the rule change did)');

select * from finish();
rollback;
