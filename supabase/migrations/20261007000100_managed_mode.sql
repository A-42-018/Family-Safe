-- T4 — managed mode (Track B) is reported by the child app so the parent sees "enforces" vs "informs".
-- `managed_mode` is NULL until the app reports it (older app versions never do), TRUE when FamilySafe is the Device
-- Owner of the phone, FALSE on a normal phone. It is a self-report (like every device column), never proof, and the
-- parent can read it but not write it (the parent UPDATE grant stays `device_name` only).
--
-- A new 6-argument overload carries the flag together with the Phase 13 facts; the 5-argument function is left as is
-- (it keeps working for callers that do not know the flag and never touches `managed_mode`).

alter table public.devices
  add column managed_mode boolean;

create or replace function public.device_update_info(
  p_device_id        uuid,
  p_sdk_level        int,
  p_security_patch   date,
  p_storage_total_mb int,
  p_storage_free_mb  int,
  p_managed_mode     boolean
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
  if p_managed_mode is null then
    raise exception 'managed mode required' using errcode = '22023';
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
         managed_mode     = p_managed_mode,
         info_updated_at  = now()
   where id = p_device_id;

  return query select 'recorded'::text;
end;
$$;

revoke all on function public.device_update_info(uuid, int, date, int, int, boolean) from public, anon, authenticated;
grant execute on function public.device_update_info(uuid, int, date, int, int, boolean) to service_role;
