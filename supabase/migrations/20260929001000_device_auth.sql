-- Phase 11 — device authentication: refresh-token rotation with reuse detection + live credential check.
-- Both functions are SECURITY DEFINER and executable by service_role ONLY. The Edge Functions verify the caller
-- (refresh token hash / device JWT) first; only SHA-256 hashes reach this layer, never raw tokens.

-- 1) Rotate a refresh token atomically.
--    'rotated'  : old credential marked rotated, new live credential (same token_family_id) inserted, id returned.
--    'reused'   : the presented token was ALREADY rotated -> it was replayed (stolen, or the response to the last
--                 refresh was lost). The whole family is revoked, the device is set REVOKED, its push registration is
--                 dropped and a DEVICE_REMOVED audit row (reason credential_reuse) is written. The parent must re-add it.
--    'invalid'  : unknown, revoked, expired, or the device is not ENROLLED. No side effects, no audit.
--    The Edge Function answers all non-'rotated' outcomes with the same 401.
--    Lock order is devices -> device_credentials, the same as enrollment_revoke_device, so a concurrent revoke can
--    never deadlock with a refresh; whichever commits first wins and the other sees the result.
create or replace function public.device_refresh(
  p_token_hash  bytea,
  p_new_hash    bytea,
  p_ttl_seconds int
)
returns table (o_outcome text, o_device_id uuid, o_credential_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid;
  v_status text;
  v_parent uuid;
  v_cred   public.device_credentials%rowtype;
  v_new    uuid;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32
     or p_new_hash is null or octet_length(p_new_hash) <> 32 then
    raise exception 'hashes must be 32 bytes' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 3600 and 31536000 then
    raise exception 'refresh ttl out of range' using errcode = '22023';
  end if;

  -- unlocked peek to learn the device, then lock devices before credentials (see header)
  select c.device_id into v_device from public.device_credentials c where c.refresh_token_hash = p_token_hash;
  if v_device is null then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  select d.enrollment_status, f.parent_id into v_status, v_parent
  from public.devices d
  join public.children c on c.id = d.child_id
  join public.families f on f.id = c.family_id
  where d.id = v_device
  for update of d;
  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  -- re-read under the device lock: a concurrent refresh/revoke has committed by now
  select * into v_cred from public.device_credentials c where c.refresh_token_hash = p_token_hash for update;
  if not found or v_status <> 'ENROLLED' or v_cred.revoked_at is not null then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_cred.rotated_at is not null then
    update public.device_credentials set revoked_at = now()
     where token_family_id = v_cred.token_family_id and revoked_at is null;
    update public.devices set enrollment_status = 'REVOKED', device_status = 'OFFLINE' where id = v_device;
    delete from public.device_tokens where device_id = v_device;
    insert into public.audit_logs (parent_id, device_id, action, metadata)
    values (v_parent, v_device, 'DEVICE_REMOVED', jsonb_build_object('reason', 'credential_reuse'));
    return query select 'reused'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_cred.expires_at <= now() then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  -- mark the old one rotated first: the "one live credential per device" index is checked per statement
  update public.device_credentials set rotated_at = now() where id = v_cred.id;
  insert into public.device_credentials (device_id, token_family_id, refresh_token_hash, expires_at)
  values (v_device, v_cred.token_family_id, p_new_hash, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_new;
  update public.device_credentials set replaced_by = v_new where id = v_cred.id;

  return query select 'rotated'::text, v_device, v_new;
end;
$$;

-- 2) Is this (device, credential) pair still allowed to call the device API? Called on EVERY authenticated device
--    request (one indexed lookup, deliberately uncached so revocation is immediate). A credential that was rotated
--    but not revoked still passes: an access token issued just before a refresh stays usable until its own exp
--    (<= 15 min). Revoked, expired, mismatched or unknown credentials, and non-ENROLLED devices, do not.
create or replace function public.device_authorize(p_device_id uuid, p_credential_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.device_credentials c
    join public.devices d on d.id = c.device_id
    where c.id = p_credential_id
      and c.device_id = p_device_id
      and c.revoked_at is null
      and c.expires_at > now()
      and d.enrollment_status = 'ENROLLED'
  );
$$;

revoke all on function public.device_refresh(bytea, bytea, int) from public, anon, authenticated;
revoke all on function public.device_authorize(uuid, uuid) from public, anon, authenticated;
grant execute on function public.device_refresh(bytea, bytea, int) to service_role;
grant execute on function public.device_authorize(uuid, uuid) to service_role;
