begin;
select plan(58);

-- Fixture: two families, one child each ---------------------------------------------------------------
insert into auth.users (id,email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.test');
insert into public.families (id,parent_id,name) values
  ('f0000000-0000-4000-8000-00000000000a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fam A'),
  ('f0000000-0000-4000-8000-00000000000b','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fam B');
insert into public.children (id,family_id,name) values
  ('c0000000-0000-4000-8000-00000000000a','f0000000-0000-4000-8000-00000000000a','Kid A'),
  ('c0000000-0000-4000-8000-00000000000b','f0000000-0000-4000-8000-00000000000b','Kid B');

-- Privileges -------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role','public.enrollment_create_token(uuid,uuid,bytea,int)','execute'), 'service_role can execute enrollment_create_token');
select ok(has_function_privilege('service_role','public.enrollment_redeem(bytea,text,text,text,text,text,bytea,int)','execute'), 'service_role can execute enrollment_redeem');
select ok(has_function_privilege('service_role','public.enrollment_revoke_device(uuid,uuid,inet)','execute'), 'service_role can execute enrollment_revoke_device');
select ok(not has_function_privilege('authenticated','public.enrollment_create_token(uuid,uuid,bytea,int)','execute'), 'authenticated cannot execute enrollment_create_token');
select ok(not has_function_privilege('authenticated','public.enrollment_redeem(bytea,text,text,text,text,text,bytea,int)','execute'), 'authenticated cannot execute enrollment_redeem');
select ok(not has_function_privilege('authenticated','public.enrollment_revoke_device(uuid,uuid,inet)','execute'), 'authenticated cannot execute enrollment_revoke_device');
select ok(not has_function_privilege('anon','public.enrollment_create_token(uuid,uuid,bytea,int)','execute'), 'anon cannot execute enrollment_create_token');
select ok(not has_function_privilege('anon','public.enrollment_redeem(bytea,text,text,text,text,text,bytea,int)','execute'), 'anon cannot execute enrollment_redeem');
select ok(not has_function_privilege('anon','public.enrollment_revoke_device(uuid,uuid,inet)','execute'), 'anon cannot execute enrollment_revoke_device');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'enrollment\_%' and p.prosecdef and p.proconfig @> array['search_path=""'] ),
  3, 'all three enrollment functions are SECURITY DEFINER with an empty search_path');

set local role service_role;

-- create_token -------------------------------------------------------------------------------------------
select ok(
  (select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode(repeat('11',32),'hex'), 600))
    between now() + interval '599 seconds' and now() + interval '601 seconds',
  'owner mints a token that expires in ~10 minutes');
reset role;
select is((select count(*)::int from public.pairing_tokens where child_id='c0000000-0000-4000-8000-00000000000a' and consumed_at is null), 1, 'one live token for child A');
select is((select created_by from public.pairing_tokens where token_hash = decode(repeat('11',32),'hex')), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'token records its creator');
set local role service_role;

select is(public.enrollment_create_token('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0000000-0000-4000-8000-00000000000a', decode(repeat('22',32),'hex'), 600), null, 'foreign parent cannot mint a token for another family''s child');
select is(public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-0000000000ff', decode(repeat('23',32),'hex'), 600), null, 'unknown child yields NULL, same as foreign');
select is(public.enrollment_create_token('cccccccc-cccc-4ccc-8ccc-cccccccccccc','c0000000-0000-4000-8000-00000000000a', decode(repeat('24',32),'hex'), 600), null, 'unknown parent yields NULL');
select throws_ok($$select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode(repeat('25',32),'hex'), 59)$$, '22023', null, 'ttl below 60 s is rejected');
select throws_ok($$select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode(repeat('25',32),'hex'), 3601)$$, '22023', null, 'ttl above 1 hour is rejected');
select throws_ok($$select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode('abcd','hex'), 600)$$, '22023', null, 'token hash must be 32 bytes');
reset role;
select is((select count(*)::int from public.pairing_tokens where token_hash in (decode(repeat('22',32),'hex'), decode(repeat('23',32),'hex'), decode(repeat('24',32),'hex'))), 0, 'rejected mints leave no rows');

-- minting again replaces the previous unconsumed token for that child only
set local role service_role;
select public.enrollment_create_token('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c0000000-0000-4000-8000-00000000000b', decode(repeat('bb',32),'hex'), 600);
select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode(repeat('12',32),'hex'), 600);
reset role;
select is((select count(*)::int from public.pairing_tokens where child_id='c0000000-0000-4000-8000-00000000000a' and consumed_at is null), 1, 'still exactly one live token for child A after re-mint');
select is((select count(*)::int from public.pairing_tokens where token_hash = decode(repeat('11',32),'hex')), 0, 'the older token was invalidated by the re-mint');
select is((select count(*)::int from public.pairing_tokens where child_id='c0000000-0000-4000-8000-00000000000b'), 1, 'child B''s token is untouched');

-- redeem: happy path ----------------------------------------------------------------------------------------
set local role service_role;
select is((select count(*)::int from public.enrollment_redeem(decode(repeat('12',32),'hex'), 'Pixel 8', 'Google', 'Pixel 8', '15', '0.1.0', decode(repeat('a1',32),'hex'), 2592000)), 1, 'valid token redeems');
reset role;
select is((select count(*)::int from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), 1, 'one device created under child A');
select is((select enrollment_status from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), 'ENROLLED', 'device is ENROLLED');
select is((select device_name || '/' || manufacturer || '/' || model || '/' || android_version || '/' || app_version from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), 'Pixel 8/Google/Pixel 8/15/0.1.0', 'device info stored');
select is((select count(*)::int from public.device_rules r join public.devices d on d.id = r.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a'), 1, 'default device_rules row created');
select is((select count(*)::int from public.device_rules r join public.devices d on d.id = r.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a' and (r.location_enabled or r.location_history_enabled or r.geofence_enabled or r.bedtime_enabled or r.school_mode_enabled)), 0, 'all monitoring starts OFF');
select is((select count(*)::int from public.device_permissions p join public.devices d on d.id = p.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a'), 1, 'default device_permissions row created');
select is((select count(*)::int from public.device_credentials c join public.devices d on d.id = c.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a' and c.revoked_at is null and c.rotated_at is null and c.refresh_token_hash = decode(repeat('a1',32),'hex')), 1, 'one live credential holding only the refresh hash');
select ok((select c.expires_at between now() + interval '29 days' and now() + interval '31 days' from public.device_credentials c join public.devices d on d.id = c.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a'), 'credential expiry follows the requested ttl');
select ok((select consumed_at is not null and consumed_device_id = (select id from public.devices where child_id='c0000000-0000-4000-8000-00000000000a') from public.pairing_tokens where token_hash = decode(repeat('12',32),'hex')), 'token consumed and linked to the new device');
select is((select count(*)::int from public.audit_logs where action='DEVICE_ENROLLED' and parent_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_id = (select id from public.devices where child_id='c0000000-0000-4000-8000-00000000000a') and metadata = '{"method":"pairing_code"}'::jsonb), 1, 'DEVICE_ENROLLED audit row written for the token creator');
select is((select ip_address from public.audit_logs where action='DEVICE_ENROLLED' and parent_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), null, 'DEVICE_ENROLLED stores no IP (child network address stays out of the audit trail)');

-- redeem: replay / unknown / expired all look the same (no rows, no side effects) -----------------------
set local role service_role;
select is((select count(*)::int from public.enrollment_redeem(decode(repeat('12',32),'hex'), 'Pixel 8', null, null, null, null, decode(repeat('a2',32),'hex'), 2592000)), 0, 'replay of a consumed token returns nothing');
select is((select count(*)::int from public.enrollment_redeem(decode(repeat('99',32),'hex'), 'Pixel 8', null, null, null, null, decode(repeat('a3',32),'hex'), 2592000)), 0, 'unknown token returns nothing');
reset role;
select is((select count(*)::int from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), 1, 'replay/unknown created no extra device');
select is((select count(*)::int from public.device_credentials where refresh_token_hash in (decode(repeat('a2',32),'hex'), decode(repeat('a3',32),'hex'))), 0, 'replay/unknown created no credential');

-- expired token: shift both timestamps back so the table CHECKs still hold
set local role service_role;
select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode(repeat('13',32),'hex'), 60);
reset role;
update public.pairing_tokens set created_at = created_at - interval '2 hours', expires_at = expires_at - interval '2 hours' where token_hash = decode(repeat('13',32),'hex');
set local role service_role;
select is((select count(*)::int from public.enrollment_redeem(decode(repeat('13',32),'hex'), 'Late', null, null, null, null, decode(repeat('a4',32),'hex'), 2592000)), 0, 'expired token returns nothing');
reset role;
select is((select count(*)::int from public.devices where device_name = 'Late'), 0, 'expired token created no device');
select ok((select consumed_at is null from public.pairing_tokens where token_hash = decode(repeat('13',32),'hex')), 'expired token is not marked consumed');

-- redeem: failure rolls the consumption back ----------------------------------------------------------------
set local role service_role;
select public.enrollment_create_token('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-00000000000a', decode(repeat('14',32),'hex'), 600);
select throws_ok($$select * from public.enrollment_redeem(decode(repeat('14',32),'hex'), '   ', null, null, null, null, decode(repeat('a5',32),'hex'), 2592000)$$, '23514', null, 'blank device name violates the devices CHECK');
select throws_ok($$select * from public.enrollment_redeem(decode(repeat('14',32),'hex'), 'X', null, null, null, null, decode('abcd','hex'), 2592000)$$, '22023', null, 'refresh hash must be 32 bytes');
select throws_ok($$select * from public.enrollment_redeem(decode(repeat('14',32),'hex'), 'X', null, null, null, null, decode(repeat('a5',32),'hex'), 10)$$, '22023', null, 'refresh ttl below 1 hour is rejected');
reset role;
select ok((select consumed_at is null and consumed_device_id is null from public.pairing_tokens where token_hash = decode(repeat('14',32),'hex')), 'failed redeems leave the token unconsumed');

-- refresh-hash uniqueness cannot be abused to overwrite a credential
set local role service_role;
select throws_ok($$select * from public.enrollment_redeem(decode(repeat('14',32),'hex'), 'Dup', null, null, null, null, decode(repeat('a1',32),'hex'), 2592000)$$, '23505', null, 'reusing an existing refresh hash is rejected');
reset role;
select ok((select consumed_at is null from public.pairing_tokens where token_hash = decode(repeat('14',32),'hex')), 'token stays unconsumed after the duplicate-hash failure');

-- revoke ----------------------------------------------------------------------------------------------------
insert into public.device_tokens (device_id, fcm_token)
  select id, repeat('f', 40) from public.devices where child_id='c0000000-0000-4000-8000-00000000000a';
select set_config('test.dev_a', (select id::text from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), true);
set local role service_role;
select is(public.enrollment_revoke_device('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_setting('test.dev_a')::uuid, '203.0.113.9'), null, 'foreign parent cannot revoke (NULL, same as missing)');
select is(public.enrollment_revoke_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-0000000000ff', null), null, 'unknown device yields NULL');
reset role;
select is((select enrollment_status from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), 'ENROLLED', 'failed revokes change nothing');
set local role service_role;
select is(public.enrollment_revoke_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_setting('test.dev_a')::uuid, '203.0.113.9'), 'revoked', 'owner revokes');
select is(public.enrollment_revoke_device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_setting('test.dev_a')::uuid, '203.0.113.9'), 'already_revoked', 'second revoke is idempotent');
reset role;
select is((select enrollment_status || '/' || device_status from public.devices where child_id='c0000000-0000-4000-8000-00000000000a'), 'REVOKED/OFFLINE', 'device is REVOKED and OFFLINE');
select is((select count(*)::int from public.device_credentials c join public.devices d on d.id = c.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a' and c.revoked_at is null), 0, 'every credential is revoked');
select is((select count(*)::int from public.device_tokens t join public.devices d on d.id = t.device_id where d.child_id='c0000000-0000-4000-8000-00000000000a'), 0, 'push registration removed');
select is((select count(*)::int from public.audit_logs where action='DEVICE_REMOVED' and parent_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and ip_address = '203.0.113.9'::inet and metadata = '{"reason":"revoked"}'::jsonb), 1, 'exactly one DEVICE_REMOVED audit row (with the parent IP)');
select is((select count(*)::int from public.devices where child_id='c0000000-0000-4000-8000-00000000000b'), 0, 'family B untouched throughout');

select * from finish();
rollback;
