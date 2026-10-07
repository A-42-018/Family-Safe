begin;
select plan(177);

-- Phase 19a-1 — schedules SQL layer. Fixture: family A (A1 service path + device read, A2 REVOKED, A3 PENDING,
-- A4 parent RPC path, A5 parent direct-write path, A6 cap, A7 cascade) and family B (B1: isolation + sort order).
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
  ('d0000000-0000-4000-8000-0000000000a6','c0000000-0000-4000-8000-00000000000a','A6','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a7','c0000000-0000-4000-8000-00000000000a','A7','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');
-- family B schedules (unsorted day list on purpose; one disabled window)
insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5b000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','Evening','BEDTIME','20:00','23:00','{5,3,1}',true);
insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5b000000-0000-4000-8000-0000000000b2','d0000000-0000-4000-8000-0000000000b1','School','SCHOOL','08:00','15:00','{1,2,3,4,5}',true);
insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5b000000-0000-4000-8000-0000000000b3','d0000000-0000-4000-8000-0000000000b1','Saturday','BEDTIME','09:00','10:00','{6}',false);
select set_config('request.jwt.claim.sub', '', true);

-- structure and privileges ------------------------------------------------------------------------------------------
select has_column('public','device_rules','timezone','device_rules.timezone exists');
select has_column('public','device_rules','schedules_revision','device_rules.schedules_revision exists');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (0, 1)$$, 'new rules start at schedules revision 0 and version 1');
select is((select timezone from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'), null::text, 'a new device follows its own time zone (NULL)');
select ok(has_function_privilege('authenticated','public.parent_save_schedule(uuid,uuid,text,text,int[],text,text,boolean)','execute'), 'authenticated can execute parent_save_schedule');
select ok(not has_function_privilege('anon','public.parent_save_schedule(uuid,uuid,text,text,int[],text,text,boolean)','execute'), 'anon cannot execute parent_save_schedule');
select ok(has_function_privilege('authenticated','public.parent_delete_schedule(uuid,uuid)','execute'), 'authenticated can execute parent_delete_schedule');
select ok(not has_function_privilege('anon','public.parent_delete_schedule(uuid,uuid)','execute'), 'anon cannot execute parent_delete_schedule');
select ok(has_function_privilege('authenticated','public.parent_set_device_timezone(uuid,text)','execute'), 'authenticated can execute parent_set_device_timezone');
select ok(not has_function_privilege('anon','public.parent_set_device_timezone(uuid,text)','execute'), 'anon cannot execute parent_set_device_timezone');
select ok(not has_function_privilege('authenticated','public.schedule_week_ranges(int[],time,time)','execute'), 'authenticated cannot execute schedule_week_ranges');
select ok(not has_function_privilege('authenticated','public.schedule_conflicts(uuid,text,int[],time,time,uuid)','execute'), 'authenticated cannot execute schedule_conflicts');
select ok(not has_function_privilege('authenticated','public.is_valid_iana_timezone(text)','execute'), 'authenticated cannot execute is_valid_iana_timezone');
select ok(not has_function_privilege('authenticated','public.schedules_guard()','execute'), 'authenticated cannot execute schedules_guard');
select ok(not has_function_privilege('authenticated','public.schedules_touch_revision()','execute'), 'authenticated cannot execute schedules_touch_revision');
select ok(not has_function_privilege('authenticated','public.device_get_config(uuid)','execute'), 'authenticated cannot execute device_get_config');
select ok(has_function_privilege('service_role','public.device_get_config(uuid)','execute'), 'service_role can execute device_get_config');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('parent_save_schedule','parent_delete_schedule','parent_set_device_timezone','schedules_guard','schedules_touch_revision','device_get_config','device_rules_config_changed')), 'the SECURITY DEFINER functions have an empty search_path');
select ok(exists (select 1 from pg_trigger t where t.tgrelid='public.schedules'::regclass and t.tgname='schedules_guard' and not t.tgisinternal), 'the guard trigger exists on schedules');
select ok((select count(*) from pg_trigger t where t.tgrelid='public.schedules'::regclass and t.tgname like 'schedules\_revision\_%')=3, 'insert, update and delete revision triggers exist');

-- week ranges (pure) ------------------------------------------------------------------------------------------------
select results_eq($$select r from public.schedule_week_ranges('{1}','08:00','15:00') r order by lower(r)$$, $$values ('[480,900)'::int4range)$$, 'Monday 08:00-15:00 is one range from minute 480 to 900');
select results_eq($$select r from public.schedule_week_ranges('{2}','22:00','06:00') r order by lower(r)$$, $$values ('[2760,3240)'::int4range)$$, 'an overnight window runs into the next day');
select results_eq($$select r from public.schedule_week_ranges('{7}','22:00','06:00') r order by lower(r)$$, $$values ('[0,360)'::int4range), ('[9960,10080)'::int4range)$$, 'a Sunday-night window wraps into Monday morning');
select results_eq($$select r from public.schedule_week_ranges('{1,3}','09:00','10:00') r order by lower(r)$$, $$values ('[540,600)'::int4range), ('[3420,3480)'::int4range)$$, 'each day gets its own range');
select is((select count(*)::int from public.schedule_week_ranges('{1,2,3,4,5}','08:00','15:00')), 5, 'five days give five ranges');
select ok((select bool_and(public.is_valid_iana_timezone(t)) from unnest(array['UTC','Europe/Berlin','Asia/Dhaka','America/Argentina/Buenos_Aires','Etc/GMT+5']) t), 'real IANA names are accepted');
select ok((select not bool_or(public.is_valid_iana_timezone(t)) from unnest(array[null,'','EST','Europe','europe/berlin','posix/Europe/Berlin','SystemV/EST5','Foo/Bar','Europe/Berlin ',repeat('A',65)||'/B','Europe//Berlin']) t), 'abbreviations, wrong case, posix trees, unknown and malformed names are rejected (NULL too)');

-- service path on A1: guard + revision triggers ---------------------------------------------------------------------
insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5c000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','Night','BEDTIME','21:00','07:00','{1,2,3,4,5,6,7}',true);
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (1, 2)$$, 'an enabled window moves the revision and the config version');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG' and status='PENDING'), 1, 'the change queued one PENDING SYNC_CONFIG');
select is((select count(*)::int from public.audit_logs), 0, 'a change without a parent session writes no audit row');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a1','Clash','BEDTIME','06:00','08:00','{1}',true)$$, '23P01', null, 'an overlapping window of the same type is refused (Monday morning is covered by Sunday night)');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (1, 2)$$, 'the refused insert left revision and version alone');
select lives_ok($$insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5c000000-0000-4000-8000-0000000000a4','d0000000-0000-4000-8000-0000000000a1','Morning','BEDTIME','07:00','08:00','{1}',true)$$, 'a window that starts exactly where another ends does not overlap');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (2, 3)$$, 'the adjacent window bumps');
select lives_ok($$insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5c000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','School','SCHOOL','08:00','15:00','{1,2,3,4,5}',true)$$, 'a different type may overlap in time');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (3, 4)$$, 'the school window bumps');
select lives_ok($$insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5c000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','Early bird','BEDTIME','06:00','08:00','{1}',false)$$, 'a DISABLED window may overlap an enabled one');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (3, 4)$$, 'a disabled window changes nothing the device sees');
select throws_ok($$update public.schedules set enabled=true where id='5c000000-0000-4000-8000-0000000000a3'$$, '23P01', null, 'enabling it would overlap -> refused on the update path too');
select lives_ok($$update public.schedules set name='Early bird 2' where id='5c000000-0000-4000-8000-0000000000a3'$$, 'renaming a disabled window works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (3, 4)$$, 'renaming a disabled window does not bump');
select lives_ok($$update public.schedules set start_time='08:30' where id='5c000000-0000-4000-8000-0000000000a2'$$, 'moving an enabled window works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (4, 5)$$, 'moving an enabled window bumps');
select lives_ok($$update public.schedules set enabled=false where id='5c000000-0000-4000-8000-0000000000a2'$$, 'disabling an enabled window works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (5, 6)$$, 'disabling bumps (the device must drop it)');
select lives_ok($$delete from public.schedules where id='5c000000-0000-4000-8000-0000000000a3'$$, 'deleting a disabled window works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (5, 6)$$, 'deleting a disabled window does not bump');
select lives_ok($$delete from public.schedules where id='5c000000-0000-4000-8000-0000000000a1'$$, 'deleting an enabled window works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (6, 7)$$, 'deleting an enabled window bumps');
select lives_ok($$delete from public.schedules where id='5c000000-0000-4000-8000-0000000000a4'$$, 'deleting the other enabled window works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (7, 8)$$, 'and bumps again');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a1' and command_type='SYNC_CONFIG'), 1, 'a PENDING command dedupes the whole burst');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a1','Secs','SCHOOL','08:00:30','09:00','{2}',true)$$, '23514', null, 'seconds are refused by the CHECK (the guard leaves invalid rows to their CHECK)');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a1','Bad','NOPE','08:00','09:00','{2}',true)$$, '23514', null, 'an unknown type is refused by the CHECK');
select lives_ok($$insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5c000000-0000-4000-8000-0000000000c1','d0000000-0000-4000-8000-0000000000a1','Late','CUSTOM','23:00','02:00','{7}',true)$$, 'a Sunday-night window is accepted');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (8, 9)$$, 'it bumps');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a1','Clash 2','CUSTOM','01:00','03:00','{1}',true)$$, '23P01', null, 'Monday 01:00 collides with the end of the Sunday-night window');
select lives_ok($$insert into public.schedules (id,device_id,name,type,start_time,end_time,days,enabled) values ('5c000000-0000-4000-8000-0000000000c2','d0000000-0000-4000-8000-0000000000a1','Early','CUSTOM','02:00','03:00','{1}',true)$$, 'Monday 02:00 starts where the Sunday-night window ends');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (9, 10)$$, 'it bumps');
select lives_ok($$update public.device_rules set timezone='Europe/Berlin' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, 'the time zone can be set on the service path');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (9, 11)$$, 'a time zone change bumps the version only');
select lives_ok($$update public.device_rules set timezone='Europe/Berlin' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, 'setting the same time zone again works');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (9, 11)$$, 'and changes nothing');
select throws_ok($$update public.device_rules set timezone='EST' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'an abbreviation is refused by the CHECK');
select throws_ok($$update public.device_rules set timezone='Europe' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'a name without a city is refused by the CHECK');
select lives_ok($$update public.device_rules set timezone=null where device_id='d0000000-0000-4000-8000-0000000000a1'$$, 'NULL (follow the device) is valid');
select lives_ok($$update public.device_rules set timezone='Europe/Berlin' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, 'and so is a name again');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a1'$$, $$values (9, 13)$$, 'two more time zone changes = two more versions');

-- revoked device: still versioned, no command -------------------------------------------------------------------------
select lives_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a2','Night','BEDTIME','21:00','22:00','{1}',true)$$, 'a window on a REVOKED device is stored');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a2'$$, $$values (1, 2)$$, 'a revoked device still versions its schedules');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a2'), 0, 'but no command is queued for a device that is not ENROLLED');

-- device_get_config -----------------------------------------------------------------------------------------------
select results_eq($$select o_outcome, o_config_version, o_daily_limit_minutes, o_daily_limit_overrides, o_app_rules, o_timezone from public.device_get_config('d0000000-0000-4000-8000-0000000000a1')$$, $$values ('ok'::text, 13, null::int, '{}'::jsonb, '[]'::jsonb, 'Europe/Berlin'::text)$$, 'A1 reads its version, its defaults and its time zone');
select results_eq($$select o_schedules from public.device_get_config('d0000000-0000-4000-8000-0000000000a1')$$, $$values ('[{"id":"5c000000-0000-4000-8000-0000000000c2","name":"Early","type":"CUSTOM","days":[1],"start_time":"02:00","end_time":"03:00"},{"id":"5c000000-0000-4000-8000-0000000000c1","name":"Late","type":"CUSTOM","days":[7],"start_time":"23:00","end_time":"02:00"}]'::jsonb)$$, 'only enabled windows are delivered, ordered by type, start time and id (the disabled school window is not)');
select results_eq($$select o_outcome, o_schedules from public.device_get_config('d0000000-0000-4000-8000-0000000000b1')$$, $$values ('ok'::text, '[{"id":"5b000000-0000-4000-8000-0000000000b1","name":"Evening","type":"BEDTIME","days":[1,3,5],"start_time":"20:00","end_time":"23:00"},{"id":"5b000000-0000-4000-8000-0000000000b2","name":"School","type":"SCHOOL","days":[1,2,3,4,5],"start_time":"08:00","end_time":"15:00"}]'::jsonb)$$, 'another device gets only its own windows, day lists ascending even if stored unsorted');
select is((select o_schedules::text !~ 'Saturday|5b000000-0000-4000-8000-0000000000b3' from public.device_get_config('d0000000-0000-4000-8000-0000000000b1')), true, 'a disabled window never reaches the device');
select is((select o_schedules::text !~ 'Late|Early' from public.device_get_config('d0000000-0000-4000-8000-0000000000b1')), true, 'no window of another device leaks');
select results_eq($$select o_outcome, o_config_version, o_timezone, o_schedules from public.device_get_config('d0000000-0000-4000-8000-0000000000a2')$$, $$values ('inactive'::text, 0, null::text, '[]'::jsonb)$$, 'REVOKED device -> inactive, no schedule data');
select results_eq($$select o_outcome, o_config_version, o_timezone, o_schedules from public.device_get_config('d0000000-0000-4000-8000-0000000000a3')$$, $$values ('inactive'::text, 0, null::text, '[]'::jsonb)$$, 'PENDING device -> inactive, no schedule data');
select results_eq($$select o_outcome, o_config_version, o_timezone, o_schedules from public.device_get_config('d0000000-0000-4000-8000-00000000ffff')$$, $$values ('inactive'::text, 0, null::text, '[]'::jsonb)$$, 'unknown device -> inactive, no schedule data');

-- cap: at most 20 windows per device --------------------------------------------------------------------------------
select lives_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) select 'd0000000-0000-4000-8000-0000000000a6','S'||g,'CUSTOM','08:00','09:00','{1}',false from generate_series(1,20) g$$, 'twenty windows are accepted');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a6','Extra','CUSTOM','08:00','09:00','{2}',false)$$, '22023', null, 'the 21st window is refused');
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a6'), 20, 'exactly 20 windows are stored');
select lives_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000b1','More','CUSTOM','08:00','09:00','{2}',false)$$, 'the cap is per device');
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a6'$$, $$values (0, 1)$$, 'disabled windows never moved the revision');

-- cascade: deleting a device removes its windows without errors -------------------------------------------------------
select lives_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a7','Night','BEDTIME','21:00','22:00','{1}',true)$$, 'A7 gets an enabled window');
select lives_ok($$delete from public.devices where id='d0000000-0000-4000-8000-0000000000a7'$$, 'deleting the device works (revision triggers tolerate the cascade)');
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a7'), 0, 'its windows are gone');

-- parent RPC path: A4 -----------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,' Night ','BEDTIME','{7,1,2,3,4,5,6}'::int[],'21:30','06:45',true)$$, $$values ('created'::text, 2)$$, 'create (unsorted days, padded name) -> created, version 2');
reset role;
select results_eq($$select name, type, days, start_time::text, end_time::text, enabled from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values ('Night'::text, 'BEDTIME'::text, '{1,2,3,4,5,6,7}'::int[], '21:30:00'::text, '06:45:00'::text, true)$$, 'stored trimmed, days sorted, minute times');
select results_eq($$select action, parent_id, metadata -> 'fields', ip_address from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4'$$, $$values ('RULE_CHANGED'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '["schedules"]'::jsonb, null::inet)$$, 'RULE_CHANGED is audited with the field name only');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG' and status='PENDING'), 1, 'one PENDING SYNC_CONFIG was queued');
set local role authenticated;
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',(select id from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4' and name='Night'),'Night','BEDTIME','{1,2,3,4,5,6,7}'::int[],'21:30','06:45',true)$$, $$values ('unchanged'::text, 2)$$, 'identical input -> unchanged, nothing written');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',(select id from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4' and name='Night'),'Night 2','BEDTIME','{1,2,3,4,5,6,7}'::int[],'21:30','06:45',true)$$, $$values ('updated'::text, 3)$$, 'rename -> updated, version 3');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',(select id from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4' and name='Night 2'),'Night 2','SCHOOL','{1,2,3,4,5,6,7}'::int[],'21:30','06:45',true)$$, $$values ('updated'::text, 4)$$, 'changing the type works (a window never collides with itself)');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Evening','SCHOOL','{1,2,3,4,5}'::int[],'22:00','23:00',true)$$, $$values ('overlap'::text, 4)$$, 'a second enabled SCHOOL window inside the first -> overlap, nothing written');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Bed','BEDTIME','{1,2,3,4,5,6,7}'::int[],'21:30','06:45',true)$$, $$values ('created'::text, 5)$$, 'the same hours with another type are fine');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Evening','SCHOOL','{1,2,3,4,5}'::int[],'22:00','23:00',false)$$, $$values ('created'::text, 5)$$, 'a disabled window may overlap: stored, version unchanged');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',(select id from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4' and name='Evening'),'Evening','SCHOOL','{1,2,3,4,5}'::int[],'22:00','23:00',true)$$, $$values ('overlap'::text, 5)$$, 'enabling it is refused');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Edge','SCHOOL','{1}'::int[],'06:45','07:00',true)$$, $$values ('created'::text, 6)$$, 'a window starting exactly where the overnight one ends is fine');
select results_eq($$select o_outcome, o_config_version from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a4',(select id from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4' and name='Edge'))$$, $$values ('deleted'::text, 7)$$, 'delete -> deleted, version 7');
select results_eq($$select o_outcome, o_config_version from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a4','5c000000-0000-4000-8000-0000000000ee')$$, $$values ('not_found'::text, 0)$$, 'deleting something that does not exist -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a4','5c000000-0000-4000-8000-0000000000c2')$$, $$values ('not_found'::text, 0)$$, 'a window of another device (same family) is not found under this device');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4','5c000000-0000-4000-8000-0000000000c2','Early','CUSTOM','{1}'::int[],'02:00','03:00',true)$$, $$values ('not_found'::text, 0)$$, 'updating a window through another device id -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','Asia/Dhaka')$$, $$values ('updated'::text, 8)$$, 'time zone set -> updated, version 8');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','Asia/Dhaka')$$, $$values ('unchanged'::text, 8)$$, 'same time zone -> unchanged');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4',null)$$, $$values ('updated'::text, 9)$$, 'NULL (follow the device) -> updated, version 9');
reset role;
select is((select timezone from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a4'), null::text, 'the time zone is NULL again');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4'), 8, 'every real change wrote exactly one audit row (8 bumps), no-ops wrote none');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata -> 'fields' = '["timezone"]'::jsonb), 2, 'time zone changes are audited by field name');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a4' and metadata::text ~* 'night|bed|evening|edge|21:30|06:45|dhaka'), 0, 'audit rows hold no names, times or zones');
select is((select count(*)::int from public.device_commands where device_id='d0000000-0000-4000-8000-0000000000a4' and command_type='SYNC_CONFIG'), 1, 'one PENDING command covered the whole sequence');
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4'), 3, 'three windows remain (Night 2, Bed, Evening)');
select is((select count(*)::int from public.schedules where id='5c000000-0000-4000-8000-0000000000c2'), 1, 'the window of the other device was not touched');

-- validation (22023) ------------------------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$select * from public.parent_save_schedule(null,null,'Valid','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'a NULL device id is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,null,'CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'a NULL name is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'an empty name is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'   ','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'a blank name is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,repeat('x',101),'CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'a 101-character name is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'a'||chr(7)||'b','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'a name with a control character is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid',null,'{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'a NULL type is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','NOPE','{1}'::int[],'10:00','11:00',true)$$, '22023', null, 'an unknown type is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM',null::int[],'10:00','11:00',true)$$, '22023', null, 'NULL days are refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{}'::int[],'10:00','11:00',true)$$, '22023', null, 'empty days are refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1,1}'::int[],'10:00','11:00',true)$$, '22023', null, 'duplicate days are refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{0}'::int[],'10:00','11:00',true)$$, '22023', null, 'weekday 0 is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{8}'::int[],'10:00','11:00',true)$$, '22023', null, 'weekday 8 is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'8:00','11:00',true)$$, '22023', null, 'a start without a leading zero is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'24:00','11:00',true)$$, '22023', null, '24:00 is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'08:60','11:00',true)$$, '22023', null, 'minute 60 is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'08:00:00','11:00',true)$$, '22023', null, 'seconds are refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],null,'11:00',true)$$, '22023', null, 'a NULL start is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'10:00','7pm',true)$$, '22023', null, 'a bad end is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'10:00',null,true)$$, '22023', null, 'a NULL end is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'10:00','10:00',true)$$, '22023', null, 'start = end is refused');
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'10:00','11:00',null)$$, '22023', null, 'a NULL enabled flag is refused');
select throws_ok($$select * from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a4',null)$$, '22023', null, 'delete needs a schedule id');
select throws_ok($$select * from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','Europe')$$, '22023', null, 'a malformed zone is refused');
select throws_ok($$select * from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','EST')$$, '22023', null, 'an abbreviation is refused');
select throws_ok($$select * from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','Foo/Bar')$$, '22023', null, 'an unknown zone is refused');
select throws_ok($$select * from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','posix/Europe/Berlin')$$, '22023', null, 'a posix-tree zone is refused');
select throws_ok($$select * from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','europe/berlin')$$, '22023', null, 'a lower-case zone is refused');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','America/Argentina/Buenos_Aires')$$, $$values ('updated'::text, 10)$$, 'a three-part zone is accepted');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','UTC')$$, $$values ('updated'::text, 11)$$, 'UTC is accepted');
reset role;
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a4'), 3, 'refused calls wrote nothing');

-- no session --------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$select * from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4',null,'Valid','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, '42501', null, 'save without a session -> 42501');
select throws_ok($$select * from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a4','5c000000-0000-4000-8000-0000000000c2')$$, '42501', null, 'delete without a session -> 42501');
select throws_ok($$select * from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a4','UTC')$$, '42501', null, 'time zone without a session -> 42501');
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

-- foreign, missing and inactive devices ------------------------------------------------------------------------------
set local role authenticated;
select results_eq($$select o_outcome, o_schedule_id, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000b1',null,'Valid','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, $$values ('not_found'::text, null::uuid, 0)$$, 'creating on a foreign device -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000b1','5b000000-0000-4000-8000-0000000000b2','School','SCHOOL','{1,2,3,4,5}'::int[],'08:00','15:00',true)$$, $$values ('not_found'::text, 0)$$, 'updating a foreign window -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a4','5b000000-0000-4000-8000-0000000000b2','School','SCHOOL','{1,2,3,4,5}'::int[],'08:00','15:00',true)$$, $$values ('not_found'::text, 0)$$, 'a foreign window id under my own device -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000b1','5b000000-0000-4000-8000-0000000000b2')$$, $$values ('not_found'::text, 0)$$, 'deleting a foreign window -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000b1','UTC')$$, $$values ('not_found'::text, 0)$$, 'time zone of a foreign device -> not_found');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-00000000ffff',null,'x','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, $$values ('not_found'::text, 0)$$, 'an unknown device is indistinguishable from a foreign one');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a2',null,'x','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, $$values ('inactive'::text, 0)$$, 'REVOKED: save -> inactive');
select results_eq($$select o_outcome, o_config_version from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a2','5c000000-0000-4000-8000-0000000000c2')$$, $$values ('inactive'::text, 0)$$, 'REVOKED: delete -> inactive');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a2','UTC')$$, $$values ('inactive'::text, 0)$$, 'REVOKED: time zone -> inactive');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a3',null,'x','CUSTOM','{1}'::int[],'10:00','11:00',true)$$, $$values ('inactive'::text, 0)$$, 'PENDING: save -> inactive');
select results_eq($$select o_outcome, o_config_version from public.parent_delete_schedule('d0000000-0000-4000-8000-0000000000a3','5c000000-0000-4000-8000-0000000000c2')$$, $$values ('inactive'::text, 0)$$, 'PENDING: delete -> inactive');
select results_eq($$select o_outcome, o_config_version from public.parent_set_device_timezone('d0000000-0000-4000-8000-0000000000a3','UTC')$$, $$values ('inactive'::text, 0)$$, 'PENDING: time zone -> inactive');
reset role;
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a3'), 0, 'nothing was written to the pending device');

-- cap through the RPC ------------------------------------------------------------------------------------------------
set local role authenticated;
select results_eq($$select o_outcome, o_schedule_id, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a6',null,'Extra','CUSTOM','{2}'::int[],'08:00','09:00',false)$$, $$values ('limit_reached'::text, null::uuid, 1)$$, 'the 21st window through the RPC -> limit_reached');
select results_eq($$select o_outcome, o_config_version from public.parent_save_schedule('d0000000-0000-4000-8000-0000000000a6',(select id from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a6' and name='S1'),'S1 renamed','CUSTOM','{1}'::int[],'08:00','09:00',false)$$, $$values ('updated'::text, 1)$$, 'a full device can still edit (a disabled rename does not bump)');
reset role;
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000a6'), 20, 'still 20 windows');

-- direct parent writes on A5 (PostgREST grants) -------------------------------------------------------------------------
set local role authenticated;
select lives_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a5','Night','BEDTIME','21:00','07:00','{1,2,3,4,5,6,7}',true)$$, 'a parent can insert a window on an owned device (guard + CHECK helpers executable)');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000a5','Clash','BEDTIME','06:00','08:00','{2}',true)$$, '23P01', null, 'the overlap rule holds for direct parent writes');
select throws_ok($$insert into public.schedules (device_id,name,type,start_time,end_time,days,enabled) values ('d0000000-0000-4000-8000-0000000000b1','Sneak','BEDTIME','22:00','23:00','{1}',true)$$, '42501', null, 'a foreign device answers 42501, not the overlap error (nothing leaks)');
select throws_ok($$update public.device_rules set timezone='UTC' where device_id='d0000000-0000-4000-8000-0000000000a5'$$, '42501', null, 'the parent has no grant on timezone');
select throws_ok($$update public.device_rules set schedules_revision=99 where device_id='d0000000-0000-4000-8000-0000000000a5'$$, '42501', null, 'the parent has no grant on schedules_revision');
select lives_ok($$update public.schedules set name='pwned' where device_id='d0000000-0000-4000-8000-0000000000b1'$$, 'updating foreign windows touches no row');
select lives_ok($$delete from public.schedules where device_id='d0000000-0000-4000-8000-0000000000b1'$$, 'deleting foreign windows touches no row');
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000b1'), 0, 'the parent cannot even see the foreign windows');
reset role;
select results_eq($$select schedules_revision, config_version from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000a5'$$, $$values (1, 2)$$, 'the direct insert was versioned');
select results_eq($$select action, parent_id, metadata -> 'fields' from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a5'$$, $$values ('RULE_CHANGED'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '["schedules"]'::jsonb)$$, 'and audited for the owning parent, field name only');

-- family B untouched ----------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000b1'), 4, 'B1 still has its four windows (three fixture rows + the cap probe)');
select is((select count(*)::int from public.schedules where device_id='d0000000-0000-4000-8000-0000000000b1' and name='pwned'), 0, 'no foreign rename got through');
select results_eq($$select schedules_revision, config_version, timezone from public.device_rules where device_id='d0000000-0000-4000-8000-0000000000b1'$$, $$values (2, 3, null::text)$$, 'B1 rules were only changed by its own fixture');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000b1'), 0, 'no audit row for B1');

select * from finish();
rollback;
