-- Phase 13a — device information: coarse, permission-free hardware/OS facts about an enrolled device.
-- Fields (all obtainable on Android without any runtime permission): API level, security patch date, total/free
-- internal storage in MB. NOT collected: serial, IMEI, advertising id, MAC/IP address, installed apps, RAM.
-- manufacturer / model / android_version / app_version already exist (enrollment + heartbeat).
-- Upload is separate from the heartbeat (rarely changes; once a day is enough) and NEVER touches device_status or
-- last_seen_at — only the heartbeat is the liveness signal.

alter table public.devices
  add column sdk_level        int  check (sdk_level between 1 and 99),
  add column security_patch   date check (security_patch >= date '2010-01-01'),
  add column storage_total_mb int  check (storage_total_mb between 1 and 16777216),
  add column storage_free_mb  int  check (storage_free_mb between 0 and 16777216),
  add column info_updated_at  timestamptz,
  add constraint devices_storage_pair_chk
    check ((storage_total_mb is null) = (storage_free_mb is null)),
  add constraint devices_storage_free_le_total_chk
    check (storage_free_mb is null or storage_free_mb <= storage_total_mb);

-- Record one device-info upload.
--   'recorded' : columns overwritten (idempotent), info_updated_at = now().
--   'inactive' : unknown device or not ENROLLED (revoked/pending) -> nothing is written; the Edge Function answers with
--                the same 401 as any other failed device authentication.
-- SECURITY DEFINER, service_role only; the device id comes from the verified JWT, never from the request body.
create or replace function public.device_update_info(
  p_device_id        uuid,
  p_sdk_level        int,
  p_security_patch   date,
  p_storage_total_mb int,
  p_storage_free_mb  int
)
returns table (o_outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_sdk_level is null or p_sdk_level not between 1 and 99 then
    raise exception 'sdk level out of range' using errcode = '22023';
  end if;
  if p_security_patch is not null
     and (p_security_patch < date '2010-01-01' or p_security_patch > current_date + 1) then
    raise exception 'security patch date out of range' using errcode = '22023';
  end if;
  if (p_storage_total_mb is null) <> (p_storage_free_mb is null) then
    raise exception 'storage values must be given together' using errcode = '22023';
  end if;
  if p_storage_total_mb is not null then
    if p_storage_total_mb not between 1 and 16777216
       or p_storage_free_mb not between 0 and 16777216
       or p_storage_free_mb > p_storage_total_mb then
      raise exception 'storage values out of range' using errcode = '22023';
    end if;
  end if;

  select d.enrollment_status into v_status
  from public.devices d
  where d.id = p_device_id
  for update;

  if not found or v_status <> 'ENROLLED' then
    return query select 'inactive'::text;
    return;
  end if;

  update public.devices
     set sdk_level        = p_sdk_level,
         security_patch   = p_security_patch,
         storage_total_mb = p_storage_total_mb,
         storage_free_mb  = p_storage_free_mb,
         info_updated_at  = now()
   where id = p_device_id;

  return query select 'recorded'::text;
end;
$$;

revoke all on function public.device_update_info(uuid, int, date, int, int) from public, anon, authenticated;
grant execute on function public.device_update_info(uuid, int, date, int, int) to service_role;
