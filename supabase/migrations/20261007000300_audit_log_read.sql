-- 30a — audit log read side and the missing APP_BLOCKED / APP_UNBLOCKED actions (prompt §39).
--
-- 1. `parent_set_app_rule` now writes APP_BLOCKED when an app becomes blocked and APP_UNBLOCKED when it stops being
--    blocked (an unblock, or the rule being cleared). Metadata is the field name only (`{"fields":["blocked"]}`):
--    no package name, no label. Limit-only changes and no-ops write nothing extra (the trigger still audits
--    RULE_CHANGED with `app_rules`). Same body as 18a otherwise.
-- 2. `parent_list_audit_logs`: the parent's own rows, newest first, keyset-paged, filtered by action / device / time.
--    SECURITY DEFINER with the caller's `auth.uid()` as the only owner filter (a foreign device id returns nothing).
-- 3. `audit_purge_expired`: 180-day retention (prompt §45); scheduling comes with Phase 32.

create or replace function public.parent_set_app_rule(
  p_device_id           uuid,
  p_package_name        text,
  p_blocked             boolean,
  p_daily_limit_minutes int
)
returns table (o_outcome text, o_config_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   text;
  v_rule     public.app_rules%rowtype;
  v_has      boolean;
  v_label    text;
  v_outcome  text;
  v_version  int;
  v_was      boolean;
  v_now      boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id required' using errcode = '22023';
  end if;
  if p_package_name is null or char_length(p_package_name) > 255
     or p_package_name !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' then
    raise exception 'invalid package name' using errcode = '22023';
  end if;
  if p_package_name = 'app.familysafe.child' then
    raise exception 'the child app cannot be restricted' using errcode = '22023';
  end if;
  if p_blocked is null then
    raise exception 'blocked flag required' using errcode = '22023';
  end if;
  if p_daily_limit_minutes is not null and (p_daily_limit_minutes < 0 or p_daily_limit_minutes > 1440) then
    raise exception 'daily limit out of range' using errcode = '22023';
  end if;

  if not public.owns_device(p_device_id) then
    return query select 'not_found'::text, 0;
    return;
  end if;

  -- Lock order: devices -> device_rules (via the triggers) -> app_rules rows; same as the other device functions.
  select d.enrollment_status into v_status from public.devices d where d.id = p_device_id for update of d;
  if not found then
    return query select 'not_found'::text, 0;
    return;
  end if;
  if v_status <> 'ENROLLED' then
    return query select 'inactive'::text, 0;
    return;
  end if;

  select * into v_rule from public.app_rules a
   where a.device_id = p_device_id and a.package_name = p_package_name for update;
  v_has := found;
  v_was := v_has and v_rule.blocked;

  if not p_blocked and p_daily_limit_minutes is null then
    -- "No restriction": a stored row is removed, nothing is stored.
    if v_has then
      delete from public.app_rules where id = v_rule.id;
      v_outcome := 'cleared';
    else
      v_outcome := 'unchanged';
    end if;
  elsif v_has then
    if v_rule.blocked = p_blocked and v_rule.daily_limit_minutes is not distinct from p_daily_limit_minutes then
      v_outcome := 'unchanged';
    else
      update public.app_rules
         set blocked = p_blocked, daily_limit_minutes = p_daily_limit_minutes
       where id = v_rule.id;
      v_outcome := 'updated';
    end if;
  else
    select left(btrim(da.label), 200) into v_label from public.device_apps da
     where da.device_id = p_device_id and da.package_name = p_package_name;
    if v_label is null or v_label = '' then
      return query select 'unknown_app'::text, 0;
      return;
    end if;
    insert into public.app_rules (device_id, package_name, app_name, blocked, daily_limit_minutes)
    values (p_device_id, p_package_name, v_label, p_blocked, p_daily_limit_minutes);
    v_outcome := 'updated';
  end if;

  -- Blocking and unblocking are audited on their own (field name only: no package name, no label). A limit change or a
  -- no-op does not count. `cleared` always ends unblocked.
  if v_outcome in ('updated', 'cleared') then
    v_now := case when v_outcome = 'cleared' then false else p_blocked end;
    if v_now is distinct from v_was then
      insert into public.audit_logs (parent_id, device_id, action, metadata)
      values ((select auth.uid()), p_device_id,
              case when v_now then 'APP_BLOCKED' else 'APP_UNBLOCKED' end,
              jsonb_build_object('fields', jsonb_build_array('blocked')));
    end if;
  end if;

  select r.config_version into v_version from public.device_rules r where r.device_id = p_device_id;
  return query select v_outcome, coalesce(v_version, 0);
end;
$$;
revoke all on function public.parent_set_app_rule(uuid, text, boolean, int) from public, anon;
grant execute on function public.parent_set_app_rule(uuid, text, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Read: the signed-in parent's own audit rows
-- ---------------------------------------------------------------------------------------------------------------------
-- Filters (all optional): p_action (an action name), p_device_id, p_from (>=), p_to (<). Cursor = the last row of the
-- previous page: p_before_at + p_before_id together, or both NULL. p_limit 1-100 (NULL = 50).
-- Returns the IP as text and the device name (NULL once the device was removed). Never writes.
create or replace function public.parent_list_audit_logs(
  p_action    text        default null,
  p_device_id uuid        default null,
  p_from      timestamptz default null,
  p_to        timestamptz default null,
  p_before_at timestamptz default null,
  p_before_id uuid        default null,
  p_limit     int         default 50
)
returns table (
  o_id          uuid,
  o_action      text,
  o_device_id   uuid,
  o_device_name text,
  o_metadata    jsonb,
  o_ip          text,
  o_created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent uuid := (select auth.uid());
  v_limit  int  := coalesce(p_limit, 50);
begin
  if v_parent is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_action is not null and p_action !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'invalid action filter' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 100 then
    raise exception 'limit out of range' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'empty time range' using errcode = '22023';
  end if;
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'cursor needs both parts' using errcode = '22023';
  end if;

  return query
    select a.id, a.action, a.device_id, d.device_name, a.metadata, host(a.ip_address)::text, a.created_at
      from public.audit_logs a
      left join public.devices d on d.id = a.device_id
     where a.parent_id = v_parent
       and (p_action is null or a.action = p_action)
       and (p_device_id is null or a.device_id = p_device_id)
       and (p_from is null or a.created_at >= p_from)
       and (p_to is null or a.created_at < p_to)
       and (p_before_at is null or (a.created_at, a.id) < (p_before_at, p_before_id))
     order by a.created_at desc, a.id desc
     limit v_limit;
end;
$$;
revoke all on function public.parent_list_audit_logs(text, uuid, timestamptz, timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.parent_list_audit_logs(text, uuid, timestamptz, timestamptz, timestamptz, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Retention: audit rows older than 180 days. service_role only; returns how many rows were deleted.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.audit_purge_expired()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with gone as (
    delete from public.audit_logs where created_at < now() - interval '180 days' returning 1
  )
  select count(*)::int into v_n from gone;
  return v_n;
end;
$$;
revoke all on function public.audit_purge_expired() from public, anon, authenticated;
grant execute on function public.audit_purge_expired() to service_role;
