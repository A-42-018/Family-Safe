-- Phase 8 — device enrollment backend: atomic RPCs behind the Edge Functions.
-- All three run as SECURITY DEFINER and are executable by service_role ONLY. Parents and devices never call them
-- directly; the Edge Functions authenticate the caller first and pass the verified parent id.
-- Only hashes reach this layer (pairing token = HMAC-SHA-256, refresh token = SHA-256); raw secrets never do.

-- 1) Mint a pairing token for one of the parent's own children. Returns expires_at, or NULL when the child does not
--    exist or is not owned by p_parent_id (foreign and missing are indistinguishable).
--    One live token per child: minting replaces any unconsumed token (expired or not) for that child.
create or replace function public.enrollment_create_token(
  p_parent_id   uuid,
  p_child_id    uuid,
  p_token_hash  bytea,
  p_ttl_seconds int
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'token hash must be 32 bytes' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 3600 then
    raise exception 'ttl must be between 60 and 3600 seconds' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.children c
    join public.families f on f.id = c.family_id
    where c.id = p_child_id and f.parent_id = p_parent_id
  ) then
    return null;
  end if;

  -- serialise minting per child so "one live token" holds under concurrent requests
  perform pg_advisory_xact_lock(hashtextextended('pairing:' || p_child_id::text, 0));

  delete from public.pairing_tokens
  where child_id = p_child_id and consumed_at is null;

  insert into public.pairing_tokens (child_id, created_by, token_hash, expires_at)
  values (p_child_id, p_parent_id, p_token_hash, now() + make_interval(secs => p_ttl_seconds))
  returning expires_at into v_expires;

  return v_expires;
end;
$$;

-- 2) Redeem a pairing token exactly once. One transaction: consume token -> create ENROLLED device (rules/permissions
--    via trigger) -> first refresh credential -> DEVICE_ENROLLED audit row. Returns zero rows for unknown, expired or
--    already-consumed tokens (the caller answers all three identically). Any error rolls the consumption back.
--    The audit row deliberately stores no IP: a child's network address would leak location information that is
--    opt-in elsewhere.
create or replace function public.enrollment_redeem(
  p_token_hash          bytea,
  p_device_name         text,
  p_manufacturer        text,
  p_model               text,
  p_android_version     text,
  p_app_version         text,
  p_refresh_hash        bytea,
  p_refresh_ttl_seconds int
)
returns table (o_device_id uuid, o_credential_id uuid, o_child_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.pairing_tokens%rowtype;
  v_device uuid;
  v_cred uuid;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32
     or p_refresh_hash is null or octet_length(p_refresh_hash) <> 32 then
    raise exception 'hashes must be 32 bytes' using errcode = '22023';
  end if;
  if p_refresh_ttl_seconds is null or p_refresh_ttl_seconds not between 3600 and 31536000 then
    raise exception 'refresh ttl out of range' using errcode = '22023';
  end if;

  -- single-use consumption: the row lock makes concurrent redeems serialise; exactly one sees consumed_at is null
  update public.pairing_tokens pt
     set consumed_at = now()
   where pt.token_hash = p_token_hash
     and pt.consumed_at is null
     and pt.expires_at > now()
  returning pt.* into v_token;

  if v_token.id is null then
    return;
  end if;

  insert into public.devices (child_id, device_name, manufacturer, model, android_version, app_version, enrollment_status)
  values (v_token.child_id, p_device_name, p_manufacturer, p_model, p_android_version, p_app_version, 'ENROLLED')
  returning id into v_device;

  update public.pairing_tokens set consumed_device_id = v_device where id = v_token.id;

  insert into public.device_credentials (device_id, refresh_token_hash, expires_at)
  values (v_device, p_refresh_hash, now() + make_interval(secs => p_refresh_ttl_seconds))
  returning id into v_cred;

  insert into public.audit_logs (parent_id, device_id, action, metadata)
  values (v_token.created_by, v_device, 'DEVICE_ENROLLED', jsonb_build_object('method', 'pairing_code'));

  o_device_id := v_device;
  o_credential_id := v_cred;
  o_child_id := v_token.child_id;
  return next;
end;
$$;

-- 3) Revoke a device the parent owns. Returns 'revoked', 'already_revoked' (idempotent, no second audit row) or NULL
--    (missing or not owned). Revokes every live credential and drops the push registration. The device row and its
--    history stay (hard removal belongs to the privacy/retention phase).
create or replace function public.enrollment_revoke_device(
  p_parent_id uuid,
  p_device_id uuid,
  p_ip        inet
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select d.enrollment_status into v_status
  from public.devices d
  join public.children c on c.id = d.child_id
  join public.families f on f.id = c.family_id
  where d.id = p_device_id and f.parent_id = p_parent_id
  for update of d;

  if not found then
    return null;
  end if;
  if v_status = 'REVOKED' then
    return 'already_revoked';
  end if;

  update public.devices
     set enrollment_status = 'REVOKED', device_status = 'OFFLINE'
   where id = p_device_id;

  update public.device_credentials
     set revoked_at = now()
   where device_id = p_device_id and revoked_at is null;

  delete from public.device_tokens where device_id = p_device_id;

  insert into public.audit_logs (parent_id, device_id, action, metadata, ip_address)
  values (p_parent_id, p_device_id, 'DEVICE_REMOVED', jsonb_build_object('reason', 'revoked'), p_ip);

  return 'revoked';
end;
$$;

revoke all on function public.enrollment_create_token(uuid, uuid, bytea, int) from public, anon, authenticated;
revoke all on function public.enrollment_redeem(bytea, text, text, text, text, text, bytea, int) from public, anon, authenticated;
revoke all on function public.enrollment_revoke_device(uuid, uuid, inet) from public, anon, authenticated;
grant execute on function public.enrollment_create_token(uuid, uuid, bytea, int) to service_role;
grant execute on function public.enrollment_redeem(bytea, text, text, text, text, text, bytea, int) to service_role;
grant execute on function public.enrollment_revoke_device(uuid, uuid, inet) to service_role;
