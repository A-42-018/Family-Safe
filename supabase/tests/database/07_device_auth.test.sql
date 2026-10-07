begin;
select plan(57);

-- Fixture: two families; family A has devices A1..A4, family B has device B1 (all ENROLLED, one live credential each) --
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
  ('d0000000-0000-4000-8000-0000000000a2','c0000000-0000-4000-8000-00000000000a','A2','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a3','c0000000-0000-4000-8000-00000000000a','A3','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000a4','c0000000-0000-4000-8000-00000000000a','A4','ENROLLED'),
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');
insert into public.device_credentials (id,device_id,refresh_token_hash,expires_at) values
  ('e0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1',decode(repeat('01',32),'hex'), now() + interval '30 days'),
  ('e0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a3',decode(repeat('31',32),'hex'), now() + interval '30 days'),
  ('e0000000-0000-4000-8000-0000000000a4','d0000000-0000-4000-8000-0000000000a4',decode(repeat('41',32),'hex'), now() + interval '30 days'),
  ('e0000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1',decode(repeat('b1',32),'hex'), now() + interval '30 days');
insert into public.device_credentials (id,device_id,refresh_token_hash,issued_at,expires_at) values
  ('e0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a2',decode(repeat('21',32),'hex'), now() - interval '2 days', now() - interval '1 day');
insert into public.device_tokens (device_id, fcm_token) values
  ('d0000000-0000-4000-8000-0000000000a1', repeat('f', 40)),
  ('d0000000-0000-4000-8000-0000000000b1', repeat('g', 40));

-- Privileges -------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role','public.device_refresh(bytea,bytea,int)','execute'), 'service_role can execute device_refresh');
select ok(has_function_privilege('service_role','public.device_authorize(uuid,uuid)','execute'), 'service_role can execute device_authorize');
select ok(not has_function_privilege('authenticated','public.device_refresh(bytea,bytea,int)','execute'), 'authenticated cannot execute device_refresh');
select ok(not has_function_privilege('authenticated','public.device_authorize(uuid,uuid)','execute'), 'authenticated cannot execute device_authorize');
select ok(not has_function_privilege('anon','public.device_refresh(bytea,bytea,int)','execute'), 'anon cannot execute device_refresh');
select ok(not has_function_privilege('anon','public.device_authorize(uuid,uuid)','execute'), 'anon cannot execute device_authorize');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('device_refresh','device_authorize') and p.prosecdef and p.proconfig @> array['search_path=""']),
  2, 'both functions are SECURITY DEFINER with an empty search_path');

set local role service_role;

-- Input validation -------------------------------------------------------------------------------------
select throws_ok($$select * from public.device_refresh(decode('abcd','hex'), decode(repeat('02',32),'hex'), 2592000)$$, '22023', null, 'presented hash must be 32 bytes');
select throws_ok($$select * from public.device_refresh(decode(repeat('01',32),'hex'), decode('abcd','hex'), 2592000)$$, '22023', null, 'new hash must be 32 bytes');
select throws_ok($$select * from public.device_refresh(decode(repeat('01',32),'hex'), decode(repeat('02',32),'hex'), 10)$$, '22023', null, 'ttl below 1 hour is rejected');
select throws_ok($$select * from public.device_refresh(decode(repeat('01',32),'hex'), decode(repeat('02',32),'hex'), 99999999)$$, '22023', null, 'ttl above 1 year is rejected');
select throws_ok($$select * from public.device_refresh(null, decode(repeat('02',32),'hex'), 2592000)$$, '22023', null, 'NULL presented hash is rejected');

-- Unknown token: no rows, no side effects ---------------------------------------------------------------
select is((select o_outcome from public.device_refresh(decode(repeat('99',32),'hex'), decode(repeat('98',32),'hex'), 2592000)), 'invalid', 'unknown token is invalid');
reset role;
select is((select count(*)::int from public.device_credentials where refresh_token_hash = decode(repeat('98',32),'hex')), 0, 'unknown token created no credential');

-- Rotation happy path ----------------------------------------------------------------------------------
set local role service_role;
create temp table r1 as select * from public.device_refresh(decode(repeat('01',32),'hex'), decode(repeat('02',32),'hex'), 2592000);
reset role;
select is((select o_outcome from r1), 'rotated', 'a live token rotates');
select is((select o_device_id from r1), 'd0000000-0000-4000-8000-0000000000a1'::uuid, 'result names the device');
select is((select o_credential_id from r1), (select id from public.device_credentials where refresh_token_hash = decode(repeat('02',32),'hex')), 'result names the NEW credential');
select ok((select rotated_at is not null and revoked_at is null and replaced_by = (select o_credential_id from r1) from public.device_credentials where id = 'e0000000-0000-4000-8000-0000000000a1'), 'old credential is rotated, chained to the new one and not revoked');
select is((select count(*)::int from public.device_credentials where device_id = 'd0000000-0000-4000-8000-0000000000a1' and rotated_at is null and revoked_at is null), 1, 'exactly one live credential remains for the device');
select ok((select n.token_family_id = o.token_family_id and n.expires_at between now() + interval '29 days' and now() + interval '31 days' from public.device_credentials n, public.device_credentials o where n.refresh_token_hash = decode(repeat('02',32),'hex') and o.id = 'e0000000-0000-4000-8000-0000000000a1'), 'new credential keeps the token family and gets a fresh ~30 day expiry');
select is((select count(*)::int from public.audit_logs where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 0, 'a normal rotation writes no audit row');

-- The chain continues; authorize matrix ---------------------------------------------------------------
set local role service_role;
create temp table r2 as select * from public.device_refresh(decode(repeat('02',32),'hex'), decode(repeat('03',32),'hex'), 2592000);
reset role;
select is((select o_outcome from r2), 'rotated', 'rotating the rotated-to token works (chain of 3)');
select set_config('t.cred1', 'e0000000-0000-4000-8000-0000000000a1', true);
select set_config('t.cred3', (select o_credential_id::text from r2), true);
set local role service_role;
select ok(public.device_authorize('d0000000-0000-4000-8000-0000000000a1', current_setting('t.cred3')::uuid), 'live credential is authorized');
select ok(public.device_authorize('d0000000-0000-4000-8000-0000000000a1', current_setting('t.cred1')::uuid), 'a rotated-but-not-revoked credential still passes (access token grace, <= 15 min by JWT exp)');
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000b1', current_setting('t.cred3')::uuid), 'credential of another device does not authorize');
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000ff'), 'unknown credential is not authorized');
select ok(not public.device_authorize(null, null), 'NULL/NULL is not authorized');
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a1', null), 'NULL credential is not authorized');
select ok(public.device_authorize('d0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000b1'), 'family B device authorizes with its own credential');

-- Expired credential ------------------------------------------------------------------------------------
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-0000000000a2'), 'expired credential is not authorized');
select is((select o_outcome from public.device_refresh(decode(repeat('21',32),'hex'), decode(repeat('22',32),'hex'), 2592000)), 'invalid', 'expired refresh token is invalid');
reset role;
select ok((select rotated_at is null and revoked_at is null from public.device_credentials where id = 'e0000000-0000-4000-8000-0000000000a2'), 'expired token is left untouched (no rotation, no revocation)');
select is((select count(*)::int from public.device_credentials where refresh_token_hash = decode(repeat('22',32),'hex')), 0, 'expired token created no credential');

-- Failed rotation rolls back ------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$select * from public.device_refresh(decode(repeat('31',32),'hex'), decode(repeat('b1',32),'hex'), 2592000)$$, '23505', null, 'reusing an existing refresh hash as the new hash is rejected');
reset role;
select ok((select rotated_at is null and replaced_by is null from public.device_credentials where id = 'e0000000-0000-4000-8000-0000000000a3'), 'the failed rotation left the old credential live and unchained');

-- Revoked through the parent path (closes the Phase 8 gap) --------------------------------------------------
set local role service_role;
select is(public.enrollment_revoke_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','d0000000-0000-4000-8000-0000000000a3', null), 'revoked', 'parent revokes device A3');
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a3', 'e0000000-0000-4000-8000-0000000000a3'), 'revoked device no longer authorizes (immediately)');
select is((select o_outcome from public.device_refresh(decode(repeat('31',32),'hex'), decode(repeat('32',32),'hex'), 2592000)), 'invalid', 'revoked device cannot refresh');
reset role;
select is((select count(*)::int from public.device_credentials where refresh_token_hash = decode(repeat('32',32),'hex')), 0, 'no credential minted for a revoked device');
select is((select count(*)::int from public.audit_logs where device_id = 'd0000000-0000-4000-8000-0000000000a3'), 1, 'only the parent''s revoke was audited (refresh attempts are not)');

-- Device REVOKED but credential row left live (defensive) --------------------------------------------------
update public.devices set enrollment_status = 'REVOKED' where id = 'd0000000-0000-4000-8000-0000000000a4';
set local role service_role;
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a4', 'e0000000-0000-4000-8000-0000000000a4'), 'authorize also checks the device status');
select is((select o_outcome from public.device_refresh(decode(repeat('41',32),'hex'), decode(repeat('42',32),'hex'), 2592000)), 'invalid', 'refresh also checks the device status');
reset role;

-- Reuse detection ---------------------------------------------------------------------------------------
-- token 01 was rotated to 02 and 02 to 03; replaying 01 means a stolen or replayed token
set local role service_role;
select is((select o_outcome from public.device_refresh(decode(repeat('01',32),'hex'), decode(repeat('04',32),'hex'), 2592000)), 'reused', 'replaying an already-rotated token is detected');
reset role;
select is((select count(*)::int from public.device_credentials where refresh_token_hash = decode(repeat('04',32),'hex')), 0, 'reuse mints no new credential');
select is((select count(*)::int from public.device_credentials where device_id = 'd0000000-0000-4000-8000-0000000000a1' and revoked_at is null), 0, 'the whole token family is revoked');
select is((select enrollment_status || '/' || device_status from public.devices where id = 'd0000000-0000-4000-8000-0000000000a1'), 'REVOKED/OFFLINE', 'the device is set REVOKED/OFFLINE');
select is((select count(*)::int from public.device_tokens where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 0, 'its push registration is dropped');
select is((select count(*)::int from public.audit_logs where action = 'DEVICE_REMOVED' and parent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_id = 'd0000000-0000-4000-8000-0000000000a1' and metadata = '{"reason":"credential_reuse"}'::jsonb and ip_address is null), 1, 'one DEVICE_REMOVED audit row (reason credential_reuse) for the owning parent');
set local role service_role;
select is((select o_outcome from public.device_refresh(decode(repeat('03',32),'hex'), decode(repeat('05',32),'hex'), 2592000)), 'invalid', 'the newest token of the revoked family is dead too');
select is((select o_outcome from public.device_refresh(decode(repeat('01',32),'hex'), decode(repeat('06',32),'hex'), 2592000)), 'invalid', 'replaying again after the family is revoked is a plain invalid');
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a1', current_setting('t.cred3')::uuid), 'access tokens of the revoked family stop authorizing');
select ok(not public.device_authorize('d0000000-0000-4000-8000-0000000000a1', current_setting('t.cred1')::uuid), 'including the older rotated credential');
reset role;
select is((select count(*)::int from public.audit_logs where device_id = 'd0000000-0000-4000-8000-0000000000a1'), 1, 'later attempts wrote no further audit rows');

-- Family B untouched throughout -------------------------------------------------------------------------
select is((select enrollment_status from public.devices where id = 'd0000000-0000-4000-8000-0000000000b1'), 'ENROLLED', 'device B1 is still ENROLLED');
select is((select count(*)::int from public.device_credentials where device_id = 'd0000000-0000-4000-8000-0000000000b1' and revoked_at is null and rotated_at is null), 1, 'device B1 keeps its live credential');
select is((select count(*)::int from public.device_tokens where device_id = 'd0000000-0000-4000-8000-0000000000b1'), 1, 'device B1 keeps its push registration');
select is((select count(*)::int from public.audit_logs where parent_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'family B has no audit rows');

select * from finish();
rollback;
