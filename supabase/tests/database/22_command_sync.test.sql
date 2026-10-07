begin;
select plan(82);

-- Fixture: A1 (the device under test), A2 (holds a command A1 must not touch), A3 REVOKED, A4/A5 for the parent tests, B1 other family
insert into auth.users (id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.test');
insert into public.families (id,parent_id,name) values
  ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A'),
  ('f0000000-0000-4000-8000-00000000000b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fam B');
insert into public.children (id,family_id,name) values
  ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A'),
  ('c0000000-0000-4000-8000-00000000000b','f0000000-0000-4000-8000-00000000000b','Kid B');
insert into public.devices (id,child_id,device_name,enrollment_status) values
  ('d0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-00000000000a','A1','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','A2','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a3','c0000000-0000-4000-8000-00000000000a','A3','REVOKED'),
  ('d0000000-0000-4000-8000-0000000000a4','c0000000-0000-4000-8000-00000000000a','A4','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a5','c0000000-0000-4000-8000-00000000000a','A5','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');
insert into public.device_commands (id,device_id,command_type,status,expires_at,created_at) values
  ('c1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-0000000000a1','SYNC_CONFIG','PENDING',now() + interval '1 hour',now()),
  ('c1000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-0000000000a1','SYNC_CONFIG','PENDING',now() - interval '1 hour',now() - interval '2 hours'),
  ('c1000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-0000000000a1','LOCK_DEVICE','PENDING',now() + interval '1 hour',now()),
  ('c1000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-0000000000a2','SYNC_CONFIG','PENDING',now() + interval '1 hour',now());

select ok(not has_function_privilege('anon','public.device_commands_pull(uuid,int)','execute'), 'anon cannot pull commands');
select ok(not has_function_privilege('authenticated','public.device_commands_pull(uuid,int)','execute'), 'authenticated cannot pull commands');
select ok(has_function_privilege('service_role','public.device_commands_pull(uuid,int)','execute'), 'service_role can pull commands');
select ok(not has_function_privilege('authenticated','public.device_register_push_token(uuid,text)','execute'), 'a parent cannot register a push token');
select ok(not has_function_privilege('authenticated','public.device_command_ack(uuid,uuid,text)','execute'), 'a parent cannot acknowledge a command');
select ok(not has_function_privilege('authenticated','public.device_commands_to_push(int)','execute'), 'a parent cannot list tokens to push');
select ok(has_function_privilege('authenticated','public.parent_send_command(uuid,text)','execute'), 'a parent can send a command');
select ok(not has_function_privilege('anon','public.parent_send_command(uuid,text)','execute'), 'anon cannot send a command');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('device_register_push_token','device_commands_pull','device_command_ack','device_commands_expire','parent_send_command','device_commands_to_push','device_command_mark_pushed','device_token_forget')), 'every command function is SECURITY DEFINER with an empty search_path');

set local role service_role;
select is((select o_outcome from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a1','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')), 'registered', 'a first token is registered');
select is((select o_outcome from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a1','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')), 'unchanged', 'the same token again is unchanged');
select is((select o_outcome from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a1','tokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2')), 'registered', 'a new token replaces the old one');
select is((select o_outcome from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a2','tokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2')), 'registered', 'a token that moves to another device is taken over');
reset role;
select is((select count(*)::int from public.device_tokens where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 0, 'the previous device lost the token it gave up');
select is((select fcm_token from public.device_tokens where device_id = 'd0000000-0000-4000-8000-0000000000a2'), 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2', 'the new device holds it');
set local role service_role;
select is((select o_outcome from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a3','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')), 'inactive', 'a REVOKED device is inactive');
select is((select o_outcome from public.device_register_push_token('d0000000-0000-4000-8000-0000000000ff','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')), 'inactive', 'an unknown device is inactive');
select throws_ok($$select * from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a1','short')$$, '22023', null, 'a short token is rejected');
select throws_ok($$select * from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a1','has space in it but long enough here')$$, '22023', null, 'a token with a space is rejected');
select throws_ok($$select * from public.device_register_push_token('d0000000-0000-4000-8000-0000000000a1',null)$$, '22023', null, 'a NULL token is rejected');
select throws_ok($$select * from public.device_register_push_token(null,'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')$$, '22023', null, 'a NULL device is rejected');
reset role;
select is((select count(*)::int from public.device_tokens), 1, 'nothing was stored for the rejected or inactive calls');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select throws_ok($$select * from public.device_tokens$$, '42501', null, 'a parent cannot read push tokens');
reset role;

set local role service_role;
select results_eq($$select o_outcome, o_id, o_command_type from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a1')$$, $$values ('ok'::text, 'c1000000-0000-4000-8000-000000000001'::uuid, 'SYNC_CONFIG'::text)$$, 'pull returns only the unexpired command of a known type');
reset role;
select is((select status from public.device_commands where id = 'c1000000-0000-4000-8000-000000000001'), 'DELIVERED', 'a pulled command is DELIVERED');
select is((select status from public.device_commands where id = 'c1000000-0000-4000-8000-000000000003'), 'PENDING', 'an unknown command type is never delivered');
set local role service_role;
select is((select count(*)::int from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a1')), 1, 'a delivered but unacknowledged command is offered again');
select is((select count(*)::int from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a1', 1)), 1, 'a limit of one is accepted');
select throws_ok($$select * from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a1',0)$$, '22023', null, 'limit 0 is rejected');
select throws_ok($$select * from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a1',51)$$, '22023', null, 'limit 51 is rejected');
select throws_ok($$select * from public.device_commands_pull(null)$$, '22023', null, 'a NULL device is rejected');
select results_eq($$select o_outcome, o_id from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a3')$$, $$values ('inactive'::text, null::uuid)$$, 'a REVOKED device gets one inactive row');
select is((select count(*)::int from public.device_commands_pull('d0000000-0000-4000-8000-0000000000b1')), 0, 'an enrolled device without commands gets no row');
select results_eq($$select o_id from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a2')$$, $$values ('c1000000-0000-4000-8000-000000000004'::uuid)$$, 'each device sees only its own commands');

select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000004','EXECUTED')), 'not_found', 'a command of another device looks like a missing one');
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-0000000000ff','EXECUTED')), 'not_found', 'an unknown command is not found');
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001','EXECUTED')), 'acked', 'the first acknowledgement is accepted');
reset role;
select results_eq($$select status, executed_at is not null from public.device_commands where id = 'c1000000-0000-4000-8000-000000000001'$$, $$values ('EXECUTED'::text, true)$$, 'an executed command carries its execution time');
set local role service_role;
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001','EXECUTED')), 'unchanged', 'a replayed acknowledgement changes nothing');
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001','FAILED')), 'unchanged', 'a different status after the fact changes nothing either');
reset role;
select is((select status from public.device_commands where id = 'c1000000-0000-4000-8000-000000000001'), 'EXECUTED', 'the command stays EXECUTED');
set local role service_role;
select is((select count(*)::int from public.device_commands_pull('d0000000-0000-4000-8000-0000000000a1')), 0, 'an executed command is not offered again');
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000002','EXECUTED')), 'expired', 'a command past its expiry is never executed late');
reset role;
select is((select status from public.device_commands where id = 'c1000000-0000-4000-8000-000000000002'), 'EXPIRED', 'and is marked EXPIRED');
insert into public.device_commands (id,device_id,command_type,status,expires_at) values ('c1000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-0000000000a1','SYNC_CONFIG','PENDING',now() + interval '1 hour');
set local role service_role;
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000005','FAILED')), 'acked', 'a command that was never pulled can be acknowledged');
reset role;
select results_eq($$select status, executed_at is null from public.device_commands where id = 'c1000000-0000-4000-8000-000000000005'$$, $$values ('FAILED'::text, true)$$, 'a failed command has no execution time');
set local role service_role;
select throws_ok($$select * from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001','DELIVERED')$$, '22023', null, 'a status the device may not set is rejected');
select throws_ok($$select * from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001',null)$$, '22023', null, 'a NULL status is rejected');
select throws_ok($$select * from public.device_command_ack(null,'c1000000-0000-4000-8000-000000000001','EXECUTED')$$, '22023', null, 'a NULL device is rejected');
select throws_ok($$select * from public.device_command_ack('d0000000-0000-4000-8000-0000000000a1',null,'EXECUTED')$$, '22023', null, 'a NULL command is rejected');
select is((select o_outcome from public.device_command_ack('d0000000-0000-4000-8000-0000000000a3','c1000000-0000-4000-8000-000000000001','EXECUTED')), 'inactive', 'a REVOKED device is inactive');
reset role;

insert into public.device_commands (id,device_id,command_type,status,expires_at,created_at) values ('c1000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-0000000000a1','SYNC_CONFIG','PENDING',now() - interval '2 hours',now() - interval '3 hours');
set local role service_role;
select is((select public.device_commands_expire()), 1, 'the sweep expires the one open command that is past its time');
reset role;
select is((select status from public.device_commands where id = 'c1000000-0000-4000-8000-000000000006'), 'EXPIRED', 'the swept command is EXPIRED');
select is((select status from public.device_commands where id = 'c1000000-0000-4000-8000-000000000003'), 'PENDING', 'an unexpired command is untouched');
set local role service_role;
select is((select public.device_commands_expire()), 0, 'a second sweep changes nothing');
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role authenticated;
select results_eq($$select o_outcome from public.parent_send_command('d0000000-0000-4000-8000-0000000000a4','SYNC_CONFIG')$$, $$values ('sent'::text)$$, 'a parent can ask a device to refresh');
reset role;
select results_eq($$select command_type, status, payload, expires_at > now() + interval '23 hours' and expires_at <= now() + interval '24 hours' from public.device_commands where device_id = 'd0000000-0000-4000-8000-0000000000a4'$$, $$values ('SYNC_CONFIG'::text, 'PENDING'::text, '{}'::jsonb, true)$$, 'the command is PENDING, empty and expires in 24 hours');
select results_eq($$select action, metadata, parent_id from public.audit_logs where device_id = 'd0000000-0000-4000-8000-0000000000a4'$$, $$values ('DEVICE_COMMAND_SENT'::text, '{"command":"SYNC_CONFIG"}'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$$, 'the send is audited with the command name only');
set local role authenticated;
select results_eq($$select o_outcome from public.parent_send_command('d0000000-0000-4000-8000-0000000000a4','SYNC_CONFIG')$$, $$values ('already_pending'::text)$$, 'a second request while one is open is not queued again');
reset role;
select is((select count(*)::int from public.device_commands where device_id = 'd0000000-0000-4000-8000-0000000000a4'), 1, 'so there is still exactly one command');
select is((select count(*)::int from public.audit_logs where device_id = 'd0000000-0000-4000-8000-0000000000a4'), 1, 'and one audit row');
insert into public.audit_logs (parent_id,device_id,action,metadata,created_at)
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'d0000000-0000-4000-8000-0000000000a5'::uuid,'DEVICE_COMMAND_SENT','{"command":"SYNC_CONFIG"}'::jsonb, now() - interval '9 minutes' * g from generate_series(1,6) g;
set local role authenticated;
select results_eq($$select o_outcome, o_command_id from public.parent_send_command('d0000000-0000-4000-8000-0000000000a5','SYNC_CONFIG')$$, $$values ('throttled'::text, null::uuid)$$, 'six sends in an hour are the limit');
select results_eq($$select o_outcome from public.parent_send_command('d0000000-0000-4000-8000-0000000000b1','SYNC_CONFIG')$$, $$values ('not_found'::text)$$, 'another family''s device is not found');
select results_eq($$select o_outcome from public.parent_send_command('d0000000-0000-4000-8000-0000000000ff','SYNC_CONFIG')$$, $$values ('not_found'::text)$$, 'an unknown device is the same not_found');
select results_eq($$select o_outcome from public.parent_send_command('d0000000-0000-4000-8000-0000000000a3','SYNC_CONFIG')$$, $$values ('inactive'::text)$$, 'a REVOKED device is inactive');
select throws_ok($$select * from public.parent_send_command('d0000000-0000-4000-8000-0000000000a4','LOCK_DEVICE')$$, '22023', null, 'a command type outside the allow-list is rejected');
select throws_ok($$select * from public.parent_send_command('d0000000-0000-4000-8000-0000000000a4',null)$$, '22023', null, 'a NULL type is rejected');
select throws_ok($$select * from public.parent_send_command(null,'SYNC_CONFIG')$$, '22023', null, 'a NULL device is rejected');
reset role;
select is((select count(*)::int from public.device_commands where device_id in ('d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000b1')), 0, 'nothing was queued for refused devices');
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok($$select * from public.parent_send_command('d0000000-0000-4000-8000-0000000000a4','SYNC_CONFIG')$$, '42501', null, 'a principal without a sub cannot send');
reset role;
set local role anon;
select throws_ok($$select * from public.parent_send_command('d0000000-0000-4000-8000-0000000000a4','SYNC_CONFIG')$$, '42501', null, 'anon cannot send');
reset role;

insert into public.device_tokens (device_id,fcm_token) values ('d0000000-0000-4000-8000-0000000000a4','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1');
update public.device_commands set status = 'PENDING' where device_id = 'd0000000-0000-4000-8000-0000000000a4';
set local role service_role;
select results_eq($$select o_command_id, o_device_id, o_fcm_token from public.device_commands_to_push()$$, $$select id, device_id, 'tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1' from public.device_commands where device_id = 'd0000000-0000-4000-8000-0000000000a4'$$, 'the push list holds an open command with its device token');
select is((select public.device_command_mark_pushed((select id from public.device_commands where device_id = 'd0000000-0000-4000-8000-0000000000a4'))), true, 'marking a command pushed works once');
select is((select public.device_command_mark_pushed((select id from public.device_commands where device_id = 'd0000000-0000-4000-8000-0000000000a4'))), false, 'and not twice');
select is((select count(*)::int from public.device_commands_to_push()), 0, 'a pushed command is not listed again');
select is((select public.device_token_forget('d0000000-0000-4000-8000-0000000000a4','tokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2')), false, 'forgetting a token the device does not hold does nothing');
select is((select public.device_token_forget('d0000000-0000-4000-8000-0000000000a4','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')), true, 'forgetting the invalid token removes it');
select is((select public.device_token_forget('d0000000-0000-4000-8000-0000000000a4','tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')), false, 'a second forget does nothing');
select throws_ok($$select * from public.device_commands_to_push(0)$$, '22023', null, 'a push limit of 0 is rejected');
select throws_ok($$select * from public.device_commands_to_push(201)$$, '22023', null, 'a push limit of 201 is rejected');
select throws_ok($$select public.device_command_mark_pushed(null)$$, '22023', null, 'a NULL command id is rejected');
reset role;
select is((select count(*)::int from public.device_tokens where device_id = 'd0000000-0000-4000-8000-0000000000a4'), 0, 'the token is gone from the table');

select * from finish();
rollback;
