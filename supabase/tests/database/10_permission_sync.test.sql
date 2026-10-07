begin;
select plan(51);

-- Fixture: family A (A1 ENROLLED, A2 REVOKED, A3 PENDING) and family B (B1 ENROLLED) ---------------------------
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
  ('d0000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-00000000000b','B1','ENROLLED');

create function pg_temp.st(cam text default 'NOT_REQUESTED', mic text default 'NOT_REQUESTED', con text default 'NOT_REQUESTED',
  sm text default 'NOT_REQUESTED', cl text default 'NOT_REQUESTED', lo text default 'NOT_REQUESTED',
  pl text default 'NOT_REQUESTED', bl text default 'NOT_REQUESTED') returns jsonb language sql as $$
  select jsonb_build_object('camera',cam,'microphone',mic,'contacts',con,'sms',sm,'call_log',cl,'location',lo,
    'precise_location',pl,'background_location',bl) $$;

select ok(has_function_privilege('service_role','public.device_update_permissions(uuid,jsonb)','execute'), 'service_role can execute device_update_permissions');
select ok(not has_function_privilege('authenticated','public.device_update_permissions(uuid,jsonb)','execute'), 'authenticated cannot execute device_update_permissions');
select ok(not has_function_privilege('anon','public.device_update_permissions(uuid,jsonb)','execute'), 'anon cannot execute device_update_permissions');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='device_update_permissions'), 'device_update_permissions is SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from public.device_permissions where device_id::text like 'd0000000-0000-4000-8000-0000000000%' and camera_status='NOT_REQUESTED' and location_status='NOT_REQUESTED'), 4, 'new devices start NOT_REQUESTED');

set local role service_role;
-- validation ------------------------------------------------------------------------------------------------------
select throws_ok($$select * from public.device_update_permissions(null, pg_temp.st())$$, '22023', null, 'NULL device id is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', null)$$, '22023', null, 'NULL states are rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', '[]'::jsonb)$$, '22023', null, 'array states are rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', '"GRANTED"'::jsonb)$$, '22023', null, 'scalar states are rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$, '22023', null, 'empty object is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st() - 'sms')$$, '22023', null, 'missing key is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st() || '{"notifications":"GRANTED"}')$$, '22023', null, 'extra key is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', (pg_temp.st() - 'sms') || '{"notifications":"GRANTED"}')$$, '22023', null, 'swapped key (same count) is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st(cam=>'MAYBE'))$$, '22023', null, 'unknown state is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st(cam=>'granted'))$$, '22023', null, 'lower-case state is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st() || '{"camera":true}')$$, '22023', null, 'boolean state is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st() || '{"camera":null}')$$, '22023', null, 'null state is rejected');
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st() || '{"camera":1}')$$, '22023', null, 'numeric state is rejected');
reset role;
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 0, 'rejected calls wrote no events');
select is((select camera_status from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000a1'), 'NOT_REQUESTED', 'rejected calls changed nothing');

-- first sync: two permissions change ------------------------------------------------------------------------------
set local role service_role;
select is((select o_outcome || ':' || o_changed from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st(cam=>'GRANTED', lo=>'DENIED'))), 'recorded:2', 'first sync records and counts 2 changes');
reset role;
select is((select camera_status || ',' || location_status || ',' || microphone_status from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000a1'), 'GRANTED,DENIED,NOT_REQUESTED', 'states are stored');
select ok((select last_verified_at = now() from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000a1'), 'last_verified_at is set');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type='PERMISSION_STATE_CHANGED'), 2, 'one event per changed permission');
select is((select metadata::text from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and metadata->>'permission'='camera'), '{"to": "GRANTED", "from": "NOT_REQUESTED", "permission": "camera"}', 'event metadata = permission, from, to only');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a1' and action='PERMISSION_STATE_CHANGED'), 1, 'one audit row per changing call');
select is((select parent_id::text from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a1' and action='PERMISSION_STATE_CHANGED'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'audit row belongs to the owning parent');
select is((select jsonb_array_length(metadata->'changes') from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a1' and action='PERMISSION_STATE_CHANGED'), 2, 'audit lists both changes');
select is((select ip_address::text from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a1' and action='PERMISSION_STATE_CHANGED'), null, 'audit row stores no IP');
select is((select device_status || ':' || coalesce(last_seen_at::text,'-') from public.devices where id='d0000000-0000-4000-8000-0000000000a1'), 'UNKNOWN:-', 'sync does not change device_status or last_seen_at');

-- unchanged sync: no events/audit, only last_verified_at moves ------------------------------------------------------
update public.device_permissions set last_verified_at = now() - interval '1 hour' where device_id='d0000000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select o_outcome || ':' || o_changed from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st(cam=>'GRANTED', lo=>'DENIED'))), 'recorded:0', 'identical sync reports 0 changes');
reset role;
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 2, 'identical sync adds no events');
select is((select count(*)::int from public.audit_logs where device_id='d0000000-0000-4000-8000-0000000000a1' and action='PERMISSION_STATE_CHANGED'), 1, 'identical sync adds no audit row');
select ok((select last_verified_at > now() - interval '1 minute' from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000a1'), 'identical sync refreshes last_verified_at');
select is((select camera_status || ',' || location_status from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000a1'), 'GRANTED,DENIED', 'identical sync leaves states untouched');

-- revocation and back -----------------------------------------------------------------------------------------------
set local role service_role;
select is((select o_changed from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st(cam=>'REVOKED', lo=>'DENIED'))), 1, 'a revoked camera is one change');
reset role;
select is((select metadata->>'from' || '>' || (metadata->>'to') from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and metadata->>'permission'='camera' and metadata->>'from'='GRANTED'), 'GRANTED>REVOKED', 'event records GRANTED -> REVOKED');
set local role service_role;
select is((select o_changed from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st(cam=>'GRANTED', mic=>'GRANTED', con=>'RESTRICTED', sm=>'NOT_AVAILABLE', cl=>'NOT_AVAILABLE', lo=>'GRANTED', pl=>'GRANTED', bl=>'DENIED'))), 8, 'all eight states can change in one call');
reset role;
select is((select background_location_status || ',' || sms_status || ',' || contacts_status from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000a1'), 'DENIED,NOT_AVAILABLE,RESTRICTED', 'all catalog columns are written');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1'), 11, 'events: 2 + 1 + 8');

-- inactive devices ----------------------------------------------------------------------------------------------------
set local role service_role;
select is((select o_outcome || ':' || o_changed from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a2', pg_temp.st(cam=>'GRANTED'))), 'inactive:0', 'REVOKED device is inactive');
select is((select o_outcome from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a3', pg_temp.st(cam=>'GRANTED'))), 'inactive', 'PENDING device is inactive');
select is((select o_outcome from public.device_update_permissions('d0000000-0000-4000-8000-0000000000ff', pg_temp.st(cam=>'GRANTED'))), 'inactive', 'unknown device is inactive');
reset role;
select is((select camera_status from public.device_permissions where device_id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3') group by camera_status), 'NOT_REQUESTED', 'inactive devices were not written');
select is((select count(*)::int from public.device_events where device_id in ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a3')), 0, 'inactive devices got no events');

-- family B untouched -----------------------------------------------------------------------------------------------------
select is((select camera_status from public.device_permissions where device_id='d0000000-0000-4000-8000-0000000000b1'), 'NOT_REQUESTED', 'family B permissions untouched');
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000b1'), 0, 'family B has no events');
select is((select count(*)::int from public.audit_logs where parent_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and action='PERMISSION_STATE_CHANGED'), 0, 'family B has no audit rows');

-- parents cannot call or write ------------------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$select * from public.device_update_permissions('d0000000-0000-4000-8000-0000000000a1', pg_temp.st())$$, '42501', null, 'authenticated cannot call the function');
select throws_ok($$update public.device_permissions set camera_status='GRANTED' where device_id='d0000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'parents still cannot write device_permissions');
reset role;

-- events for permissions do not leak to device status ------------------------------------------------------------------
select is((select count(*)::int from public.device_events where device_id='d0000000-0000-4000-8000-0000000000a1' and event_type in ('DEVICE_ONLINE','DEVICE_OFFLINE','BATTERY_LOW')), 0, 'no liveness events from a permission sync');

select finish();
rollback;
