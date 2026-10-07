begin;
select plan(19);

insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'a@example.test');
insert into public.families (id, parent_id, name) values ('f0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Fam');
insert into public.children (id, family_id, name) values ('c0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','Kid');
insert into public.devices (id, child_id, device_name) values
  ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','Dev1'),
  ('d0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','Dev2');

-- updated_at trigger ------------------------------------------------------
update public.devices set device_name = 'Renamed' where id = 'd0000000-0000-4000-8000-000000000001';
select cmp_ok((select updated_at from public.devices where id = 'd0000000-0000-4000-8000-000000000001'), '>', (select created_at from public.devices where id = 'd0000000-0000-4000-8000-000000000001'), 'updated_at moves on update');

-- geofences ---------------------------------------------------------------
insert into public.geofences (id, device_id, name, latitude, longitude, radius_meters) values
  ('90000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Home',10,10,100);
select lives_ok($$insert into public.geofence_events (device_id, geofence_id, event_type, occurred_at) values ('d0000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','ENTER',now())$$, 'event on own geofence');
select throws_ok($$insert into public.geofence_events (device_id, geofence_id, event_type, occurred_at) values ('d0000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','ENTER',now())$$, '23503', null, 'event cannot reference another device''s geofence');
select throws_ok($$insert into public.geofence_events (device_id, geofence_id, event_type, occurred_at) values ('d0000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','INSIDE',now())$$, '23514', null, 'event_type ENTER|EXIT');
insert into public.geofences (device_id, name, latitude, longitude, radius_meters)
  select 'd0000000-0000-4000-8000-000000000002', 'g'||i, 1, 1, 100 from generate_series(1,100) i;
select throws_ok($$insert into public.geofences (device_id, name, latitude, longitude, radius_meters) values ('d0000000-0000-4000-8000-000000000002','g101',1,1,100)$$, '23514', null, '101st geofence rejected');

-- location idempotency ----------------------------------------------------
insert into public.location_points (device_id, latitude, longitude, accuracy_meters, recorded_at) values ('d0000000-0000-4000-8000-000000000001',1,1,5,'2026-01-01T00:00:00Z');
select throws_ok($$insert into public.location_points (device_id, latitude, longitude, accuracy_meters, recorded_at) values ('d0000000-0000-4000-8000-000000000001',1,1,5,'2026-01-01T00:00:00Z')$$, '23505', null, 'duplicate location upload rejected');

-- device_credentials: one live token per device, rotation ------------------
insert into public.device_credentials (id, device_id, refresh_token_hash, expires_at)
  values ('a0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001', decode(repeat('01',32),'hex'), now()+interval '30 days');
select throws_ok($$insert into public.device_credentials (device_id, refresh_token_hash, expires_at) values ('d0000000-0000-4000-8000-000000000001', decode(repeat('02',32),'hex'), now()+interval '30 days')$$, '23505', null, 'second live credential for same device rejected');
update public.device_credentials set rotated_at = now() where id = 'a0000000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.device_credentials (device_id, refresh_token_hash, expires_at) values ('d0000000-0000-4000-8000-000000000001', decode(repeat('02',32),'hex'), now()+interval '30 days')$$, 'new live credential after rotation');

-- device_commands state machine -------------------------------------------
insert into public.device_commands (id, device_id, command_type, payload, expires_at)
  values ('b0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','SYNC_RULES','{"v":1}', now()+interval '5 minutes');
select throws_ok($$update public.device_commands set status = 'EXECUTED', executed_at = now() where id = 'b0000000-0000-4000-8000-000000000001'$$, '23514', null, 'PENDING cannot jump to EXECUTED');
update public.device_commands set status = 'DELIVERED' where id = 'b0000000-0000-4000-8000-000000000001';
select lives_ok($$update public.device_commands set status = 'EXECUTED', executed_at = now() where id = 'b0000000-0000-4000-8000-000000000001'$$, 'DELIVERED -> EXECUTED');
select throws_ok($$update public.device_commands set status = 'DELIVERED' where id = 'b0000000-0000-4000-8000-000000000001'$$, '23514', null, 'terminal state is final (replay blocked)');
select throws_ok($$update public.device_commands set payload = '{"v":2}' where id = 'b0000000-0000-4000-8000-000000000001'$$, '42501', null, 'payload immutable');
select throws_ok($$update public.device_commands set expires_at = now() + interval '1 year' where id = 'b0000000-0000-4000-8000-000000000001'$$, '42501', null, 'expires_at immutable');
insert into public.device_commands (id, device_id, command_type, expires_at, created_at)
  values ('b0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','LOCK_NOW', now() - interval '1 minute', now() - interval '10 minutes');
update public.device_commands set status = 'DELIVERED' where id = 'b0000000-0000-4000-8000-000000000002';
select throws_ok($$update public.device_commands set status = 'EXECUTED', executed_at = now() where id = 'b0000000-0000-4000-8000-000000000002'$$, '23514', null, 'expired command cannot execute');
select lives_ok($$update public.device_commands set status = 'EXPIRED' where id = 'b0000000-0000-4000-8000-000000000002'$$, 'expired command can be marked EXPIRED');

-- audit_logs append-only, survives device removal ---------------------------
insert into public.audit_logs (id, parent_id, device_id, action, ip_address) values ('e0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001','DEVICE_REMOVED','203.0.113.5');
select throws_ok($$update public.audit_logs set action = 'LOGIN' where id = 'e0000000-0000-4000-8000-000000000001'$$, '42501', null, 'audit_logs rows are immutable');
delete from public.devices where id = 'd0000000-0000-4000-8000-000000000001';
select is((select device_id from public.audit_logs where id = 'e0000000-0000-4000-8000-000000000001'), null, 'audit row survives device deletion (device_id set null)');

-- cascade family -> child -> device -> data ----------------------------------
delete from public.families where id = 'f0000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.children where family_id = 'f0000000-0000-4000-8000-000000000001')
        + (select count(*)::int from public.devices where id in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002'))
        + (select count(*)::int from public.geofences where device_id in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002'))
        + (select count(*)::int from public.device_rules where device_id in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002'))
        + (select count(*)::int from public.device_permissions where device_id in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')), 0, 'family delete cascades to children, devices, rules, permissions, geofences');
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111')
        + (select count(*)::int from public.audit_logs where id = 'e0000000-0000-4000-8000-000000000001'), 0, 'deleting auth user removes profile and audit rows');

select * from finish();
rollback;
